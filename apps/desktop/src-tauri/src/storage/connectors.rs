use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use super::app_paths::AppPaths;

const STORE_VERSION: u32 = 1;
const KEYCHAIN_SERVICE: &str = "com.pi-desktop.app.connector";
const MAX_ARGS: usize = 32;
const MAX_ENV_ENTRIES: usize = 32;
const MAX_VALUE_BYTES: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorProfile {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub approved: bool,
    pub content_hash: String,
    #[serde(default)]
    pub credential_ref: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDraft {
    pub id: Option<String>,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRuntimeConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorTestResult {
    pub ok: bool,
    pub tool_count: usize,
    pub message: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStoreFile {
    version: u32,
    connectors: Vec<ConnectorProfile>,
}

pub struct ConnectorStore;

impl ConnectorStore {
    pub fn list(path: &Path) -> Result<Vec<ConnectorProfile>, String> {
        Ok(load(path)?.connectors)
    }

    pub fn save(paths: &AppPaths, draft: ConnectorDraft) -> Result<ConnectorProfile, String> {
        if draft.name.trim().is_empty() {
            return Err("Connector name is required".into());
        }
        if draft.command.trim().is_empty() {
            return Err("Connector command is required".into());
        }
        if draft.args.len() > MAX_ARGS {
            return Err("Connector has too many arguments".into());
        }
        if draft.env.len() > MAX_ENV_ENTRIES {
            return Err("Connector has too many environment variables".into());
        }
        for value in draft.env.values() {
            if value.len() > MAX_VALUE_BYTES {
                return Err("Connector environment value is too long".into());
            }
        }

        let mut store = load(&paths.connectors_file)?;
        let now = unix_millis()?;
        let id = draft
            .id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing = store
            .connectors
            .iter()
            .find(|connector| connector.id == id)
            .cloned();
        let content_hash = connector_content_hash(&draft);
        let credential_ref = update_connector_credential(
            &id,
            existing
                .as_ref()
                .and_then(|connector| connector.credential_ref.clone()),
            draft.token.as_deref(),
            false,
        )?;
        let profile = ConnectorProfile {
            id: id.clone(),
            name: draft.name.trim().to_string(),
            transport: "stdio".into(),
            command: draft.command.trim().to_string(),
            args: draft.args,
            env: draft.env,
            enabled: draft.enabled,
            approved: true,
            content_hash,
            credential_ref,
            created_at: existing
                .as_ref()
                .map(|connector| connector.created_at)
                .unwrap_or(now),
            updated_at: now,
        };

        if let Some(index) = store
            .connectors
            .iter()
            .position(|connector| connector.id == id)
        {
            store.connectors[index] = profile.clone();
        } else {
            store.connectors.push(profile.clone());
        }
        store.version = STORE_VERSION;
        persist(&paths.connectors_file, &store)?;
        Ok(profile)
    }

    pub fn set_enabled(
        paths: &AppPaths,
        id: &str,
        enabled: bool,
    ) -> Result<ConnectorProfile, String> {
        let mut store = load(&paths.connectors_file)?;
        let connector = store
            .connectors
            .iter_mut()
            .find(|connector| connector.id == id)
            .ok_or_else(|| format!("Unknown connector: {id}"))?;
        connector.enabled = enabled;
        connector.updated_at = unix_millis()?;
        let result = connector.clone();
        store.version = STORE_VERSION;
        persist(&paths.connectors_file, &store)?;
        Ok(result)
    }

    pub fn delete(paths: &AppPaths, id: &str) -> Result<(), String> {
        let mut store = load(&paths.connectors_file)?;
        let connector = store
            .connectors
            .iter()
            .find(|connector| connector.id == id)
            .cloned()
            .ok_or_else(|| format!("Unknown connector: {id}"))?;
        store.connectors.retain(|connector| connector.id != id);
        if let Some(reference) = connector.credential_ref.as_deref() {
            let _ = delete_secret(reference);
        }
        store.version = STORE_VERSION;
        persist(&paths.connectors_file, &store)
    }

    /// Smoke-test a connector by spawning its stdio server and verifying the
    /// process starts and stays alive briefly.
    pub fn test(paths: &AppPaths, id: &str) -> Result<ConnectorTestResult, String> {
        let store = load(&paths.connectors_file)?;
        let connector = store
            .connectors
            .iter()
            .find(|connector| connector.id == id)
            .ok_or_else(|| format!("Unknown connector: {id}"))?;
        let runtime_dir = paths.connector_runtime.join(&connector.id);
        fs::create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
        fs::set_permissions(&runtime_dir, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;

        let mut command = Command::new(&connector.command);
        command
            .args(&connector.args)
            .envs(&connector.env)
            .current_dir(&runtime_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot start connector '{}': {error}", connector.name))?;
        std::thread::sleep(Duration::from_millis(800));
        match child.try_wait() {
            Ok(Some(status)) => Err(format!(
                "Connector '{}' exited immediately (code {:?})",
                connector.name,
                status.code()
            )),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                Ok(ConnectorTestResult {
                    ok: true,
                    tool_count: 0,
                    message: format!("Connector '{}' started successfully", connector.name),
                })
            }
            Err(error) => Err(format!(
                "Cannot inspect connector '{}': {error}",
                connector.name
            )),
        }
    }

    pub fn runtime_configs(path: &Path) -> Result<Vec<ConnectorRuntimeConfig>, String> {
        let store = load(path)?;
        Ok(store
            .connectors
            .into_iter()
            .filter(|connector| connector.enabled && connector.approved)
            .map(|connector| ConnectorRuntimeConfig {
                id: connector.id,
                name: connector.name,
                command: connector.command,
                args: connector.args,
                env: connector.env,
                content_hash: connector.content_hash,
            })
            .collect())
    }
}

fn connector_content_hash(draft: &ConnectorDraft) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(draft.name.as_bytes());
    hasher.update([0]);
    hasher.update(draft.command.as_bytes());
    for arg in &draft.args {
        hasher.update([0]);
        hasher.update(arg.as_bytes());
    }
    let mut entries: Vec<(&String, &String)> = draft.env.iter().collect();
    entries.sort_by(|left, right| left.0.cmp(right.0));
    for (key, value) in entries {
        hasher.update([0]);
        hasher.update(key.as_bytes());
        hasher.update([0]);
        hasher.update(value.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn keychain_entry(reference: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, reference)
        .map_err(|error| format!("Keychain entry failed: {error}"))
}

fn update_connector_credential(
    connector_id: &str,
    existing_ref: Option<String>,
    token: Option<&str>,
    clear: bool,
) -> Result<Option<String>, String> {
    if clear {
        if let Some(reference) = existing_ref.as_deref() {
            let _ = delete_secret(reference);
        }
        return Ok(None);
    }
    if let Some(token) = token {
        if !token.is_empty() {
            let reference =
                existing_ref.unwrap_or_else(|| format!("connector/{connector_id}/token"));
            keychain_entry(&reference)?
                .set_password(token)
                .map_err(|error| format!("Keychain write failed: {error}"))?;
            return Ok(Some(reference));
        }
    }
    Ok(existing_ref)
}

fn delete_secret(reference: &str) -> Result<(), String> {
    match keychain_entry(reference)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Keychain delete failed for {reference}: {error}")),
    }
}

fn load(path: &Path) -> Result<ConnectorStoreFile, String> {
    if !path.exists() {
        return Ok(ConnectorStoreFile {
            version: STORE_VERSION,
            connectors: Vec::new(),
        });
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read connector store {}: {error}", path.display()))?;
    let store: ConnectorStoreFile = serde_json::from_str(&content)
        .map_err(|error| format!("Cannot parse connector store {}: {error}", path.display()))?;
    if store.version > STORE_VERSION {
        return Err(format!(
            "Connector store version {} is newer than supported ({STORE_VERSION})",
            store.version
        ));
    }
    Ok(store)
}

fn persist(path: &Path, store: &ConnectorStoreFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Connector store has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Cannot secure connector store directory: {error}"))?;
    let encoded = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Cannot serialize connector store: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| format!("Cannot write connector store: {error}"))?;
    file.write_all(&encoded)
        .map_err(|error| format!("Cannot write connector store: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot persist connector store {}: {error}", path.display()))
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("Clock skew: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture() -> (AppPaths, PathBuf) {
        let root = std::env::temp_dir().join(format!("pi-connector-test-{}", Uuid::new_v4()));
        let paths = AppPaths {
            logs: root.join("data/logs"),
            attachments: root.join("data/attachments"),
            packages: root.join("data/packages"),
            extension_packages: root.join("data/packages/extensions"),
            backups: root.join("data/backups"),
            worktrees: root.join("data/worktrees"),
            database_file: root.join("data/pi-desktop.sqlite3"),
            endpoints_file: root.join("data/endpoints.json"),
            extensions_file: root.join("data/extensions.json"),
            resources_file: root.join("data/resources.json"),
            agent_skills: root.join("data/agent/skills"),
            agent_prompts: root.join("data/agent/prompts"),
            connectors_file: root.join("data/connectors.json"),
            connector_runtime: root.join("data/connector-runtime"),
            tasks_file: root.join("data/tasks.json"),
            root: root.join("data"),
        };
        (paths, root)
    }

    #[test]
    fn saves_and_lists_connector() {
        let (paths, root) = fixture();
        let saved = ConnectorStore::save(
            &paths,
            ConnectorDraft {
                id: None,
                name: "filesystem".into(),
                command: "npx".into(),
                args: vec!["-y", "@modelcontextprotocol/server-filesystem".into()]
                    .into_iter()
                    .map(Into::into)
                    .collect(),
                env: HashMap::new(),
                enabled: true,
                token: None,
            },
        )
        .expect("save");

        let listed = ConnectorStore::list(&paths.connectors_file).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, saved.id);
        assert_eq!(listed[0].name, "filesystem");
        assert!(listed[0].enabled);
        assert!(!listed[0].content_hash.is_empty());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_empty_command() {
        let (paths, root) = fixture();
        let result = ConnectorStore::save(
            &paths,
            ConnectorDraft {
                id: None,
                name: "bad".into(),
                command: "".into(),
                args: vec![],
                env: HashMap::new(),
                enabled: false,
                token: None,
            },
        );
        assert!(result.is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn enable_disable_and_delete() {
        let (paths, root) = fixture();
        let saved = ConnectorStore::save(
            &paths,
            ConnectorDraft {
                id: None,
                name: "echo-server".into(),
                command: "/bin/echo".into(),
                args: vec![],
                env: HashMap::new(),
                enabled: false,
                token: None,
            },
        )
        .expect("save");

        ConnectorStore::set_enabled(&paths, &saved.id, true).expect("enable");
        let runtime = ConnectorStore::runtime_configs(&paths.connectors_file).expect("runtime");
        assert_eq!(runtime.len(), 1);
        assert_eq!(runtime[0].id, saved.id);

        ConnectorStore::set_enabled(&paths, &saved.id, false).expect("disable");
        assert!(ConnectorStore::runtime_configs(&paths.connectors_file)
            .expect("runtime")
            .is_empty());

        ConnectorStore::delete(&paths, &saved.id).expect("delete");
        assert!(ConnectorStore::list(&paths.connectors_file)
            .expect("list")
            .is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn test_reports_failure_for_missing_command() {
        let (paths, root) = fixture();
        let saved = ConnectorStore::save(
            &paths,
            ConnectorDraft {
                id: None,
                name: "missing".into(),
                command: "/nonexistent/definitely-not-a-command".into(),
                args: vec![],
                env: HashMap::new(),
                enabled: false,
                token: None,
            },
        )
        .expect("save");

        let result = ConnectorStore::test(&paths, &saved.id);
        assert!(result.is_err());
        fs::remove_dir_all(root).ok();
    }
}
