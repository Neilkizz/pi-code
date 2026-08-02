use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use super::app_paths::AppPaths;

const STORE_VERSION: u32 = 1;
const MAX_CONTENT_BYTES: usize = 32 * 1024;
const MAX_DESCRIPTION_BYTES: usize = 1024;
const MAX_NAME_BYTES: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    Skill,
    Prompt,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResourceScope {
    #[default]
    Global,
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProfile {
    pub id: String,
    pub name: String,
    pub kind: ResourceKind,
    #[serde(default)]
    pub description: Option<String>,
    pub content: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub scope: ResourceScope,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDraft {
    pub id: Option<String>,
    pub name: String,
    pub kind: ResourceKind,
    #[serde(default)]
    pub description: Option<String>,
    pub content: String,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceStoreFile {
    version: u32,
    resources: Vec<ResourceProfile>,
}

pub struct ResourceStore;

impl ResourceStore {
    pub fn list(path: &Path, kind: Option<ResourceKind>) -> Result<Vec<ResourceProfile>, String> {
        let store = load(path)?;
        Ok(match kind {
            Some(kind) => store
                .resources
                .into_iter()
                .filter(|resource| resource.kind == kind)
                .collect(),
            None => store.resources,
        })
    }

    pub fn save(paths: &AppPaths, draft: ResourceDraft) -> Result<ResourceProfile, String> {
        validate_name(&draft.name)?;
        if let Some(description) = &draft.description {
            if description.len() > MAX_DESCRIPTION_BYTES {
                return Err("Resource description is too long".into());
            }
        }
        if draft.content.len() > MAX_CONTENT_BYTES {
            return Err(format!(
                "Resource content exceeds {} bytes",
                MAX_CONTENT_BYTES
            ));
        }

        let mut store = load(&paths.resources_file)?;
        let now = unix_millis()?;
        let id = draft
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing = store
            .resources
            .iter()
            .find(|resource| resource.id == id)
            .cloned();
        let profile = ResourceProfile {
            id: id.clone(),
            name: draft.name.clone(),
            kind: draft.kind,
            description: draft.description.clone(),
            content: draft.content.clone(),
            enabled: draft.enabled,
            scope: ResourceScope::Global,
            created_at: existing
                .as_ref()
                .map(|resource| resource.created_at)
                .unwrap_or(now),
            updated_at: now,
        };

        sync_injection_file(paths, &profile)?;

        if let Some(index) = store
            .resources
            .iter()
            .position(|resource| resource.id == id)
        {
            store.resources[index] = profile.clone();
        } else {
            store.resources.push(profile.clone());
        }
        store.version = STORE_VERSION;
        persist(&paths.resources_file, &store)?;
        Ok(profile)
    }

    pub fn set_enabled(
        paths: &AppPaths,
        id: &str,
        enabled: bool,
    ) -> Result<ResourceProfile, String> {
        let mut store = load(&paths.resources_file)?;
        let profile = store
            .resources
            .iter_mut()
            .find(|resource| resource.id == id)
            .ok_or_else(|| format!("Unknown resource: {id}"))?;
        profile.enabled = enabled;
        profile.updated_at = unix_millis()?;
        sync_injection_file(paths, profile)?;
        let result = profile.clone();
        store.version = STORE_VERSION;
        persist(&paths.resources_file, &store)?;
        Ok(result)
    }

    pub fn delete(paths: &AppPaths, id: &str) -> Result<(), String> {
        let mut store = load(&paths.resources_file)?;
        let profile = store
            .resources
            .iter()
            .find(|resource| resource.id == id)
            .cloned()
            .ok_or_else(|| format!("Unknown resource: {id}"))?;
        store.resources.retain(|resource| resource.id != id);
        remove_injection_file(paths, &profile);
        store.version = STORE_VERSION;
        persist(&paths.resources_file, &store)
    }

    pub fn import(
        paths: &AppPaths,
        source_path: &Path,
        kind: ResourceKind,
    ) -> Result<ResourceProfile, String> {
        let content = fs::read_to_string(source_path)
            .map_err(|error| format!("Cannot read resource file: {error}"))?;
        let name = source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("resource")
            .to_string();
        let description = content
            .lines()
            .find(|line| line.starts_with("# "))
            .map(|line| line[2..].to_string());
        ResourceStore::save(
            paths,
            ResourceDraft {
                id: None,
                name,
                kind,
                description,
                content,
                enabled: false,
            },
        )
    }

    pub fn export_content(path: &Path, id: &str) -> Result<String, String> {
        let store = load(path)?;
        let profile = store
            .resources
            .iter()
            .find(|resource| resource.id == id)
            .ok_or_else(|| format!("Unknown resource: {id}"))?;
        Ok(render_markdown(profile))
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_NAME_BYTES {
        return Err("Resource name must be 1-64 characters".into());
    }
    if !name.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err("Resource name may only contain lowercase letters, digits, and hyphens".into());
    }
    Ok(())
}

fn sync_injection_file(paths: &AppPaths, profile: &ResourceProfile) -> Result<(), String> {
    if profile.enabled {
        write_injection_file(paths, profile)
    } else {
        remove_injection_file(paths, profile);
        Ok(())
    }
}

fn write_injection_file(paths: &AppPaths, profile: &ResourceProfile) -> Result<(), String> {
    let content = render_markdown(profile);
    match profile.kind {
        ResourceKind::Skill => {
            let directory = paths.agent_skills.join(&profile.name);
            fs::create_dir_all(&directory)
                .map_err(|error| format!("Cannot create skill directory: {error}"))?;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("Cannot secure skill directory: {error}"))?;
            write_private(directory.join("SKILL.md"), content.as_bytes())
        }
        ResourceKind::Prompt => {
            fs::create_dir_all(&paths.agent_prompts)
                .map_err(|error| format!("Cannot create prompts directory: {error}"))?;
            fs::set_permissions(&paths.agent_prompts, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("Cannot secure prompts directory: {error}"))?;
            write_private(
                paths.agent_prompts.join(format!("{}.md", profile.name)),
                content.as_bytes(),
            )
        }
    }
}

fn remove_injection_file(paths: &AppPaths, profile: &ResourceProfile) {
    match profile.kind {
        ResourceKind::Skill => {
            let directory = paths.agent_skills.join(&profile.name);
            let _ = fs::remove_file(directory.join("SKILL.md"));
            let _ = fs::remove_dir(directory);
        }
        ResourceKind::Prompt => {
            let _ = fs::remove_file(paths.agent_prompts.join(format!("{}.md", profile.name)));
        }
    }
}

fn render_markdown(profile: &ResourceProfile) -> String {
    let mut result = String::from("---\n");
    result.push_str(&format!("name: {}\n", profile.name));
    if let Some(description) = &profile.description {
        result.push_str(&format!("description: {}\n", description));
    }
    result.push_str("---\n\n");
    result.push_str(&profile.content);
    result
}

fn write_private(path: PathBuf, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| format!("Cannot write resource file {}: {error}", path.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("Cannot write resource file {}: {error}", path.display()))
}

fn load(path: &Path) -> Result<ResourceStoreFile, String> {
    if !path.exists() {
        return Ok(ResourceStoreFile {
            version: STORE_VERSION,
            resources: Vec::new(),
        });
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read resource store {}: {error}", path.display()))?;
    let store: ResourceStoreFile = serde_json::from_str(&content)
        .map_err(|error| format!("Cannot parse resource store {}: {error}", path.display()))?;
    if store.version > STORE_VERSION {
        return Err(format!(
            "Resource store version {} is newer than supported ({STORE_VERSION})",
            store.version
        ));
    }
    Ok(store)
}

fn persist(path: &Path, store: &ResourceStoreFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Resource store has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Cannot secure resource store directory: {error}"))?;
    let encoded = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Cannot serialize resource store: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    write_private(temporary.clone(), &encoded)?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot persist resource store {}: {error}", path.display()))
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

    fn fixture() -> (AppPaths, PathBuf) {
        let root = std::env::temp_dir().join(format!("pi-resource-test-{}", Uuid::new_v4()));
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
            tasks_file: root.join("data/tasks.json"),
            root: root.join("data"),
        };
        (paths, root)
    }

    #[test]
    fn saves_enabled_skill_and_writes_injection_file() {
        let (paths, root) = fixture();
        let profile = ResourceStore::save(
            &paths,
            ResourceDraft {
                id: None,
                name: "review-code".into(),
                kind: ResourceKind::Skill,
                description: Some("Review code carefully".into()),
                content: "Always review the diff before committing.".into(),
                enabled: true,
            },
        )
        .expect("save");

        let injection = paths.agent_skills.join("review-code").join("SKILL.md");
        assert!(injection.exists());
        let text = fs::read_to_string(injection).expect("read");
        assert!(text.contains("name: review-code"));
        assert!(text.contains("description: Review code carefully"));
        assert!(text.contains("Always review the diff"));

        let listed = ResourceStore::list(&paths.resources_file, None).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, profile.id);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn disabling_removes_injection_file_but_keeps_content() {
        let (paths, root) = fixture();
        let saved = ResourceStore::save(
            &paths,
            ResourceDraft {
                id: None,
                name: "summarize".into(),
                kind: ResourceKind::Prompt,
                description: None,
                content: "Summarize the conversation.".into(),
                enabled: true,
            },
        )
        .expect("save");
        assert!(paths.agent_prompts.join("summarize.md").exists());

        ResourceStore::set_enabled(&paths, &saved.id, false).expect("disable");
        assert!(!paths.agent_prompts.join("summarize.md").exists());

        let listed =
            ResourceStore::list(&paths.resources_file, Some(ResourceKind::Prompt)).expect("list");
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].enabled);
        assert_eq!(listed[0].content, "Summarize the conversation.");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_invalid_names() {
        let (paths, root) = fixture();
        let result = ResourceStore::save(
            &paths,
            ResourceDraft {
                id: None,
                name: "Bad Name!".into(),
                kind: ResourceKind::Skill,
                description: None,
                content: "x".into(),
                enabled: false,
            },
        );
        assert!(result.is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn imports_file_as_disabled_resource() {
        let (paths, root) = fixture();
        let source = root.join("import-me.md");
        fs::create_dir_all(&root).ok();
        fs::write(&source, "# My Prompt\n\nBody here.").expect("write");

        let imported =
            ResourceStore::import(&paths, &source, ResourceKind::Prompt).expect("import");
        assert!(!imported.enabled);
        assert_eq!(imported.name, "import-me");
        assert_eq!(imported.description.as_deref(), Some("My Prompt"));
        assert!(imported.content.contains("Body here."));

        fs::remove_dir_all(root).ok();
    }
}
