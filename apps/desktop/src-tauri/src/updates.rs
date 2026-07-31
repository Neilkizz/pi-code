use crate::{
    agent::protocol::command_envelope,
    marketplace,
    storage::{app_paths::AppPaths, extensions::ExtensionStore},
};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    os::unix::fs::{symlink, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use uuid::Uuid;
use walkdir::WalkDir;

#[cfg(not(debug_assertions))]
use tauri::Manager;

const STORE_VERSION: u32 = 1;
const PI_AGENT_PACKAGE: &str = "@earendil-works/pi-coding-agent";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferences {
    #[serde(default)]
    pub auto_update_pi_agent: bool,
    #[serde(default)]
    pub auto_update_extensions: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentUpdateStatus {
    pub bundled_version: String,
    pub active_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub restart_required: bool,
    pub preferences: UpdatePreferences,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticUpdateReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pi_agent_updated: Option<String>,
    pub extensions_updated: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRuntime {
    version: String,
    host_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStore {
    version: u32,
    #[serde(default)]
    preferences: UpdatePreferences,
    active_runtime: Option<ActiveRuntime>,
    #[serde(default)]
    restart_required: bool,
    #[serde(default)]
    updated_at: u64,
}

impl Default for UpdatePreferences {
    fn default() -> Self {
        Self {
            auto_update_pi_agent: false,
            auto_update_extensions: false,
        }
    }
}

impl Default for UpdateStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            preferences: UpdatePreferences::default(),
            active_runtime: None,
            restart_required: false,
            updated_at: 0,
        }
    }
}

pub fn status(app: &AppHandle, paths: &AppPaths) -> Result<PiAgentUpdateStatus, String> {
    match marketplace::latest_version(PI_AGENT_PACKAGE) {
        Ok(latest_version) => status_with_latest(app, paths, latest_version, None),
        Err(error) => status_with_latest(app, paths, String::new(), Some(error)),
    }
}

fn status_with_latest(
    app: &AppHandle,
    paths: &AppPaths,
    mut latest_version: String,
    error: Option<String>,
) -> Result<PiAgentUpdateStatus, String> {
    let bundled_version = package_version(&bundled_host_root(app)?.join("node_modules"))?;
    let store = load(&updates_file(paths))?;
    let preferred_managed = preferred_active_runtime(app, paths, &store);
    let active_version = preferred_managed
        .as_ref()
        .map(|(_, version)| version.clone())
        .unwrap_or_else(|| bundled_version.clone());
    if latest_version.is_empty() {
        latest_version.clone_from(&active_version);
    }
    Ok(PiAgentUpdateStatus {
        update_available: error.is_none() && is_newer(&latest_version, &active_version),
        bundled_version,
        active_version,
        latest_version,
        restart_required: store.restart_required && preferred_managed.is_some(),
        preferences: store.preferences,
        error,
    })
}

pub fn preferences(paths: &AppPaths) -> Result<UpdatePreferences, String> {
    Ok(load(&updates_file(paths))?.preferences)
}

pub fn save_preferences(
    paths: &AppPaths,
    preferences: UpdatePreferences,
) -> Result<UpdatePreferences, String> {
    let mut store = load(&updates_file(paths))?;
    store.preferences = preferences.clone();
    store.updated_at = unix_millis()?;
    persist(&updates_file(paths), &store)?;
    Ok(preferences)
}

pub fn install_latest(app: &AppHandle, paths: &AppPaths) -> Result<PiAgentUpdateStatus, String> {
    let latest = marketplace::latest_version(PI_AGENT_PACKAGE)?;
    let existing = load(&updates_file(paths))?;
    let bundled_version = package_version(&bundled_host_root(app)?.join("node_modules"))?;
    let current_version = preferred_active_runtime(app, paths, &existing)
        .map(|(_, version)| version)
        .unwrap_or(bundled_version);
    if !is_newer(&latest, &current_version) {
        return status_with_latest(app, paths, latest, None);
    }

    let runtimes_root = core_runtimes(paths);
    fs::create_dir_all(&runtimes_root).map_err(|error| error.to_string())?;
    fs::set_permissions(&runtimes_root, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    let target = runtimes_root.join(&latest);
    if !target.exists() {
        let staging = runtimes_root.join(format!(".staging-{}", Uuid::new_v4()));
        let protocol_backup = runtimes_root.join(format!(".protocol-{}", Uuid::new_v4()));
        let prepared = (|| {
            let bundled_root = bundled_host_root(app)?;
            let protocol_source = bundled_root
                .join("node_modules/@pi-desktop/protocol")
                .canonicalize()
                .map_err(|error| format!("resolve desktop protocol package: {error}"))?;
            copy_tree(&protocol_source, &protocol_backup)?;
            copy_tree(&bundled_root, &staging)?;
            write_private_json(
                &staging.join("package.json"),
                &json!({
                    "name": "pi-desktop-managed-host",
                    "private": true,
                    "type": "module",
                    "dependencies": {
                        PI_AGENT_PACKAGE: latest,
                        "typebox": "1.1.38"
                    }
                }),
            )?;
            marketplace::run_npm_install(
                app,
                paths,
                &staging,
                &format!("{PI_AGENT_PACKAGE}@{latest}"),
            )?;
            let protocol_destination = staging.join("node_modules/@pi-desktop/protocol");
            remove_path_if_present(&protocol_destination)?;
            copy_tree(&protocol_backup, &protocol_destination)?;
            fs::remove_dir_all(&protocol_backup).map_err(|error| error.to_string())?;
            let installed = package_version(&staging.join("node_modules"))?;
            if installed != latest {
                return Err(format!(
                    "Pi-Agent update verification failed: expected {latest}, installed {installed}"
                ));
            }
            preflight_host(app, paths, &staging, &latest)?;
            make_tree_readonly(&staging)?;
            fs::rename(&staging, &target)
                .map_err(|error| format!("activate managed Pi-Agent runtime: {error}"))?;
            Ok(())
        })();
        if let Err(error) = prepared {
            if staging.exists() {
                let _ = make_tree_writable(&staging);
                let _ = fs::remove_dir_all(&staging);
            }
            if protocol_backup.exists() {
                let _ = fs::remove_dir_all(&protocol_backup);
            }
            return Err(error);
        }
    } else {
        validate_managed_runtime_target(&runtimes_root, &target, &latest)?;
        preflight_host(app, paths, &target, &latest)?;
    }
    validate_managed_runtime_target(&runtimes_root, &target, &latest)?;

    let mut store = load(&updates_file(paths))?;
    store.active_runtime = Some(ActiveRuntime {
        version: latest.clone(),
        host_path: target.display().to_string(),
    });
    store.restart_required = true;
    store.updated_at = unix_millis()?;
    persist(&updates_file(paths), &store)?;
    status_with_latest(app, paths, latest, None)
}

pub fn run_automatic_updates(
    app: &AppHandle,
    paths: &AppPaths,
) -> Result<AutomaticUpdateReport, String> {
    paths.ensure().map_err(|error| error.to_string())?;
    let preferences = preferences(paths)?;
    let mut report = AutomaticUpdateReport {
        pi_agent_updated: None,
        extensions_updated: Vec::new(),
        errors: Vec::new(),
    };

    if preferences.auto_update_pi_agent {
        match status(app, paths) {
            Ok(current) => {
                if let Some(error) = current.error {
                    report
                        .errors
                        .push(format!("Pi-Agent update check: {error}"));
                } else if current.update_available {
                    match install_latest(app, paths) {
                        Ok(updated) => {
                            report.pi_agent_updated = Some(updated.latest_version);
                        }
                        Err(error) => report.errors.push(format!("Pi-Agent: {error}")),
                    }
                }
            }
            Err(error) => report
                .errors
                .push(format!("Pi-Agent update check: {error}")),
        }
    }

    if preferences.auto_update_extensions {
        let profiles = ExtensionStore::list(&paths.extensions_file)?;
        for profile in profiles {
            let (Some(package_name), Some(current_version)) =
                (profile.package_name, profile.package_version)
            else {
                continue;
            };
            let latest_version = match marketplace::latest_version(&package_name) {
                Ok(version) => version,
                Err(error) => {
                    report
                        .errors
                        .push(format!("{package_name} update check: {error}"));
                    continue;
                }
            };
            if !is_newer(&latest_version, &current_version) {
                continue;
            }
            let prepared = match marketplace::prepare_npm_package(
                app,
                paths,
                &package_name,
                Some(&latest_version),
            ) {
                Ok(prepared) => prepared,
                Err(error) => {
                    report
                        .errors
                        .push(format!("{package_name} download: {error}"));
                    continue;
                }
            };
            match ExtensionStore::install_marketplace(
                &paths.extensions_file,
                &paths.extension_packages,
                prepared,
            ) {
                Ok(extension) => report.extensions_updated.push(format!(
                    "{}@{}",
                    package_name,
                    extension.package_version.unwrap_or(latest_version)
                )),
                Err(error) => report
                    .errors
                    .push(format!("{package_name} activation: {error}")),
            }
        }
    }

    Ok(report)
}

pub fn active_runtime(app: &AppHandle, paths: &AppPaths) -> Option<(PathBuf, String)> {
    let store = load(&updates_file(paths)).ok()?;
    preferred_active_runtime(app, paths, &store)
}

pub fn mark_started(paths: &AppPaths, version: &str) -> Result<(), String> {
    let mut store = load(&updates_file(paths))?;
    if store
        .active_runtime
        .as_ref()
        .is_some_and(|runtime| runtime.version == version)
    {
        store.restart_required = false;
        store.updated_at = unix_millis()?;
        persist(&updates_file(paths), &store)?;
    }
    Ok(())
}

fn validated_active_runtime(paths: &AppPaths, store: &UpdateStore) -> Option<(PathBuf, String)> {
    let runtime = store.active_runtime.as_ref()?;
    let root = core_runtimes(paths).canonicalize().ok()?;
    let host_path = PathBuf::from(&runtime.host_path).canonicalize().ok()?;
    if !host_path.starts_with(&root)
        || !host_path.join("dist/main.js").is_file()
        || package_version(&host_path.join("node_modules"))
            .ok()
            .as_deref()
            != Some(runtime.version.as_str())
    {
        return None;
    }
    Some((host_path, runtime.version.clone()))
}

fn preferred_active_runtime(
    app: &AppHandle,
    paths: &AppPaths,
    store: &UpdateStore,
) -> Option<(PathBuf, String)> {
    let managed = validated_active_runtime(paths, store)?;
    let bundled_version =
        package_version(&bundled_host_root(app).ok()?.join("node_modules")).ok()?;
    if is_newer(&managed.1, &bundled_version) {
        Some(managed)
    } else {
        None
    }
}

fn validate_managed_runtime_target(
    runtimes_root: &Path,
    target: &Path,
    expected_version: &str,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(target)
        .map_err(|error| format!("inspect managed Pi-Agent runtime: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Managed Pi-Agent runtime is not a regular directory".into());
    }
    let root = runtimes_root
        .canonicalize()
        .map_err(|error| format!("resolve managed Pi-Agent root: {error}"))?;
    let resolved = target
        .canonicalize()
        .map_err(|error| format!("resolve managed Pi-Agent runtime: {error}"))?;
    if !resolved.starts_with(&root)
        || !resolved.join("dist/main.js").is_file()
        || package_version(&resolved.join("node_modules"))? != expected_version
    {
        return Err("Managed Pi-Agent runtime failed its path or version boundary".into());
    }
    Ok(())
}

fn preflight_host(
    app: &AppHandle,
    paths: &AppPaths,
    host_root: &Path,
    expected_version: &str,
) -> Result<(), String> {
    let entry = host_root.join("dist/main.js");
    let node = node_executable(app)?;
    let preflight_data = core_runtimes(paths).join(format!(".preflight-{}", Uuid::new_v4()));
    fs::create_dir_all(&preflight_data).map_err(|error| error.to_string())?;
    let mut child = match Command::new(node)
        .arg(&entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&preflight_data);
            return Err(format!("start Pi-Agent update preflight: {error}"));
        }
    };
    let result = (|| -> Result<bool, String> {
        let command = command_envelope(
            "host.bootstrap",
            json!({ "appDataDir": preflight_data.display().to_string() }),
        )?;
        let encoded = serde_json::to_string(&command).map_err(|error| error.to_string())?;
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Pi-Agent preflight stdin was unavailable".to_string())?;
        stdin
            .write_all(encoded.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| error.to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Pi-Agent preflight stdout was unavailable".to_string())?;
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let deadline = SystemTime::now() + Duration::from_secs(12);
        while SystemTime::now() < deadline {
            match receiver.recv_timeout(Duration::from_millis(250)) {
                Ok(line) => {
                    let Ok(message) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if message.get("type").and_then(Value::as_str) == Some("host.hello") {
                        let version = message
                            .pointer("/hello/hostVersion")
                            .and_then(Value::as_str);
                        let protocol = message
                            .pointer("/hello/selectedVersion")
                            .and_then(Value::as_u64);
                        return Ok(version == Some(expected_version) && protocol == Some(2));
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        Ok(false)
    })();
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_dir_all(preflight_data);
    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!(
            "Pi-Agent {expected_version} did not pass the desktop protocol preflight"
        )),
        Err(error) => Err(format!(
            "Pi-Agent {expected_version} preflight failed: {error}"
        )),
    }
}

fn package_version(node_modules: &Path) -> Result<String, String> {
    let manifest = node_modules.join("@earendil-works/pi-coding-agent/package.json");
    let value: Value = serde_json::from_str(
        &fs::read_to_string(&manifest)
            .map_err(|error| format!("read {}: {error}", manifest.display()))?,
    )
    .map_err(|error| format!("parse {}: {error}", manifest.display()))?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Pi-Agent package has no version".into())
}

#[cfg(debug_assertions)]
fn bundled_host_root(_app: &AppHandle) -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/pi-agent-host")
        .canonicalize()
        .map_err(|error| error.to_string())
}

#[cfg(not(debug_assertions))]
fn bundled_host_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|root| root.join("runtime/pi-agent-host"))
        .map_err(|error| error.to_string())
}

#[cfg(debug_assertions)]
fn node_executable(_app: &AppHandle) -> Result<PathBuf, String> {
    Ok(std::env::var_os("PI_DESKTOP_NODE_BINARY")
        .map_or_else(|| PathBuf::from("node"), PathBuf::from))
}

#[cfg(not(debug_assertions))]
fn node_executable(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|root| root.join("runtime/node/bin/node"))
        .map_err(|error| error.to_string())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "Copy source is not a directory: {}",
            source.display()
        ));
    }
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        let target = destination.join(relative);
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o700))
                .map_err(|error| error.to_string())?;
        } else if metadata.file_type().is_symlink() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            symlink(
                fs::read_link(entry.path()).map_err(|error| error.to_string())?,
                &target,
            )
            .map_err(|error| error.to_string())?;
        } else if metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn remove_path_if_present(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    }
}

fn make_tree_readonly(root: &Path) -> Result<(), String> {
    let mut directories = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            directories.push(entry.into_path());
        } else if metadata.is_file() {
            fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o400))
                .map_err(|error| error.to_string())?;
        }
    }
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for directory in directories {
        fs::set_permissions(directory, fs::Permissions::from_mode(0o500))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn make_tree_writable(root: &Path) -> Result<(), String> {
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o700))
                .map_err(|error| error.to_string())?;
        } else if metadata.is_file() {
            fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn load(path: &Path) -> Result<UpdateStore, String> {
    if !path.exists() {
        return Ok(UpdateStore::default());
    }
    let value: UpdateStore =
        serde_json::from_str(&fs::read_to_string(path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("Invalid updates.json: {error}"))?;
    if value.version > STORE_VERSION {
        return Err(format!(
            "updates.json version {} is newer than supported version {STORE_VERSION}",
            value.version
        ));
    }
    Ok(value)
}

fn persist(path: &Path, store: &UpdateStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    write_private_json(
        &temporary,
        &serde_json::to_value(store).map_err(|error| error.to_string())?,
    )?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn write_private_json(path: &Path, value: &Value) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn updates_file(paths: &AppPaths) -> PathBuf {
    paths.root.join("updates.json")
}

fn core_runtimes(paths: &AppPaths) -> PathBuf {
    paths.packages.join("pi-agent")
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

fn is_newer(candidate: &str, current: &str) -> bool {
    match (Version::parse(candidate), Version::parse(current)) {
        (Ok(candidate), Ok(current)) => candidate > current,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_preferences_round_trip_with_private_permissions() {
        let root = std::env::temp_dir().join(format!("pi-update-test-{}", Uuid::new_v4()));
        let paths = AppPaths {
            logs: root.join("logs"),
            attachments: root.join("attachments"),
            packages: root.join("packages"),
            extension_packages: root.join("packages/extensions"),
            backups: root.join("backups"),
            worktrees: root.join("worktrees"),
            database_file: root.join("database.sqlite3"),
            endpoints_file: root.join("endpoints.json"),
            extensions_file: root.join("extensions.json"),
            tasks_file: root.join("tasks.json"),
            root: root.clone(),
        };
        paths.ensure().expect("paths");
        let preferences = save_preferences(
            &paths,
            UpdatePreferences {
                auto_update_pi_agent: true,
                auto_update_extensions: true,
            },
        )
        .expect("preferences");
        assert!(preferences.auto_update_pi_agent);
        assert_eq!(preferences, super::preferences(&paths).expect("read"));
        assert_eq!(
            fs::metadata(updates_file(&paths))
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn semantic_versions_do_not_regress_the_bundled_runtime() {
        assert!(is_newer("0.84.0", "0.83.9"));
        assert!(!is_newer("0.83.9", "0.84.0"));
        assert!(!is_newer("0.84.0", "0.84.0"));
        assert!(!is_newer("../../escape", "0.84.0"));
    }

    #[test]
    fn managed_runtime_target_must_be_a_real_versioned_child() {
        let base = std::env::temp_dir().join(format!("pi-runtime-boundary-{}", Uuid::new_v4()));
        let root = base.join("managed");
        let valid = root.join("0.84.0");
        write_test_runtime(&valid, "0.84.0");
        assert!(validate_managed_runtime_target(&root, &valid, "0.84.0").is_ok());

        let outside = base.join("outside");
        write_test_runtime(&outside, "0.85.0");
        let linked = root.join("0.85.0");
        symlink(&outside, &linked).expect("symlink");
        assert!(validate_managed_runtime_target(&root, &linked, "0.85.0").is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }

    fn write_test_runtime(root: &Path, version: &str) {
        fs::create_dir_all(root.join("dist")).expect("dist");
        fs::create_dir_all(root.join("node_modules/@earendil-works/pi-coding-agent"))
            .expect("package");
        fs::write(root.join("dist/main.js"), "export {};").expect("entry");
        fs::write(
            root.join("node_modules/@earendil-works/pi-coding-agent/package.json"),
            format!(r#"{{"name":"{PI_AGENT_PACKAGE}","version":"{version}"}}"#),
        )
        .expect("manifest");
    }
}
