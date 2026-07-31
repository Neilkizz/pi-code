use crate::marketplace::PreparedPackage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use walkdir::WalkDir;

const STORE_VERSION: u32 = 3;
const MAX_FILES: usize = 200;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MARKETPLACE_FILES: usize = 1_000;
const MAX_MARKETPLACE_SCAN_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 20_000;
const MAX_PACKAGE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FindingSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionSourceKind {
    Local,
    Npm,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionIntegrityMode {
    ScannableV1,
    FullTreeV1,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFinding {
    pub severity: FindingSeverity,
    pub capability: String,
    pub message: String,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionProfile {
    pub id: String,
    pub name: String,
    pub source_path: String,
    #[serde(default = "default_source_kind")]
    pub source_kind: ExtensionSourceKind,
    #[serde(default)]
    pub package_name: Option<String>,
    #[serde(default)]
    pub package_version: Option<String>,
    #[serde(default)]
    pub install_path: String,
    #[serde(default = "default_integrity_mode")]
    pub integrity_mode: ExtensionIntegrityMode,
    pub enabled: bool,
    pub approved: bool,
    pub content_hash: String,
    #[serde(default)]
    pub active_version: String,
    #[serde(default)]
    pub versions: Vec<ExtensionVersion>,
    pub findings: Vec<ExtensionFinding>,
    pub scanned_files: usize,
    pub scanned_bytes: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionVersion {
    pub content_hash: String,
    pub install_path: String,
    #[serde(default = "default_integrity_mode")]
    pub integrity_mode: ExtensionIntegrityMode,
    #[serde(default)]
    pub package_version: Option<String>,
    pub approved: bool,
    pub findings: Vec<ExtensionFinding>,
    pub scanned_files: usize,
    pub scanned_bytes: u64,
    pub installed_at: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRuntimeConfig {
    pub id: String,
    pub name: String,
    pub install_path: String,
    pub content_hash: String,
    pub integrity_mode: ExtensionIntegrityMode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDraft {
    pub id: Option<String>,
    pub name: String,
    pub source_path: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub approved: bool,
    pub approved_content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScanResult {
    pub source_path: String,
    pub content_hash: String,
    pub findings: Vec<ExtensionFinding>,
    pub scanned_files: usize,
    pub scanned_bytes: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionStoreFile {
    version: u32,
    extensions: Vec<ExtensionProfile>,
}

pub struct ExtensionStore;

impl ExtensionStore {
    pub fn list(path: &Path) -> Result<Vec<ExtensionProfile>, String> {
        Ok(load(path)?.extensions)
    }

    pub fn scan(source_path: &str) -> Result<ExtensionScanResult, String> {
        scan_path(Path::new(source_path))
    }

    pub fn save(
        path: &Path,
        packages_root: &Path,
        draft: ExtensionDraft,
    ) -> Result<ExtensionProfile, String> {
        let mut store = load(path)?;
        let scan = scan_path(Path::new(&draft.source_path))?;
        let has_elevated_findings = scan.findings.iter().any(|finding| {
            matches!(
                finding.severity,
                FindingSeverity::Warning | FindingSeverity::Critical
            )
        });
        let approved = draft.approved
            && draft.approved_content_hash.as_deref() == Some(scan.content_hash.as_str());
        if draft.enabled && has_elevated_findings && !approved {
            return Err(
                "Extension has warning or critical findings. Re-scan and approve this exact content before enabling."
                    .into(),
            );
        }

        let now = unix_millis()?;
        let id = draft
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing = store
            .extensions
            .iter()
            .find(|extension| extension.id == id)
            .cloned();
        let install_path =
            install_snapshot(Path::new(&scan.source_path), packages_root, &id, &scan, now)?;
        let version = ExtensionVersion {
            content_hash: scan.content_hash.clone(),
            install_path: install_path.clone(),
            integrity_mode: ExtensionIntegrityMode::ScannableV1,
            package_version: None,
            approved,
            findings: scan.findings.clone(),
            scanned_files: scan.scanned_files,
            scanned_bytes: scan.scanned_bytes,
            installed_at: now,
        };
        let mut versions = existing
            .as_ref()
            .map(|extension| extension.versions.clone())
            .unwrap_or_default();
        if let Some(index) = versions
            .iter()
            .position(|candidate| candidate.content_hash == version.content_hash)
        {
            versions[index] = version;
        } else {
            versions.push(version);
        }
        versions.sort_by(|left, right| right.installed_at.cmp(&left.installed_at));
        let profile = ExtensionProfile {
            id: id.clone(),
            name: required(&draft.name, "Extension name")?,
            source_path: scan.source_path,
            source_kind: ExtensionSourceKind::Local,
            package_name: None,
            package_version: None,
            install_path,
            integrity_mode: ExtensionIntegrityMode::ScannableV1,
            enabled: draft.enabled,
            approved,
            content_hash: scan.content_hash.clone(),
            active_version: scan.content_hash,
            versions,
            findings: scan.findings,
            scanned_files: scan.scanned_files,
            scanned_bytes: scan.scanned_bytes,
            created_at: existing
                .as_ref()
                .map(|extension| extension.created_at)
                .unwrap_or(now),
            updated_at: now,
        };

        if let Some(index) = store
            .extensions
            .iter()
            .position(|extension| extension.id == id)
        {
            store.extensions[index] = profile.clone();
        } else {
            store.extensions.push(profile.clone());
        }
        store.version = STORE_VERSION;
        persist(path, &store)?;
        Ok(profile)
    }

    pub fn install_marketplace(
        path: &Path,
        packages_root: &Path,
        prepared: PreparedPackage,
    ) -> Result<ExtensionProfile, String> {
        let staging_root = prepared.staging_root.clone();
        let result = (|| {
            let mut store = load(path)?;
            let mut scan = scan_marketplace_path(&prepared.package_root)?;
            if prepared.dependency_count > 0 {
                scan.findings.push(ExtensionFinding {
                    severity: FindingSeverity::Warning,
                    capability: "npm-dependencies".into(),
                    message: format!(
                        "{} runtime dependencies were installed with lifecycle scripts disabled; review the package provenance before enabling",
                        prepared.dependency_count
                    ),
                    file: Some("package.json".into()),
                });
            }
            scan.findings.push(ExtensionFinding {
                severity: FindingSeverity::Info,
                capability: "marketplace-install".into(),
                message:
                    "Downloaded from the npm package listed by Pi's official catalog; catalog presence is not a security endorsement, and lifecycle scripts were not executed"
                        .into(),
                file: None,
            });
            let content_hash = integrity_hash(&staging_root)?;
            scan.content_hash = content_hash.clone();
            let now = unix_millis()?;
            let existing = store
                .extensions
                .iter()
                .find(|extension| extension.package_name.as_deref() == Some(&prepared.package_name))
                .cloned();
            let has_elevated_findings = scan.findings.iter().any(|finding| {
                matches!(
                    finding.severity,
                    FindingSeverity::Warning | FindingSeverity::Critical
                )
            });
            let preserve_enabled = existing.as_ref().is_some_and(|extension| extension.enabled)
                && !has_elevated_findings;
            let id = existing
                .as_ref()
                .map(|extension| extension.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let extension_root = packages_root.join(&id);
            let version_root = extension_root.join(&content_hash);
            let source_root = version_root.join("source");
            if source_root.exists() {
                if integrity_hash(&source_root)? != content_hash {
                    return Err(format!(
                        "Existing marketplace snapshot failed integrity verification: {}",
                        source_root.display()
                    ));
                }
                fs::remove_dir_all(&staging_root).map_err(|error| error.to_string())?;
            } else {
                create_private_dir(&version_root)?;
                fs::rename(&staging_root, &source_root)
                    .map_err(|error| format!("activate marketplace snapshot: {error}"))?;
                make_snapshot_readonly(&source_root)?;
            }

            let version = ExtensionVersion {
                content_hash: content_hash.clone(),
                install_path: source_root.display().to_string(),
                integrity_mode: ExtensionIntegrityMode::FullTreeV1,
                package_version: Some(prepared.version.clone()),
                approved: false,
                findings: scan.findings.clone(),
                scanned_files: scan.scanned_files,
                scanned_bytes: scan.scanned_bytes,
                installed_at: now,
            };
            let mut versions = existing
                .as_ref()
                .map(|extension| extension.versions.clone())
                .unwrap_or_default();
            if let Some(index) = versions
                .iter()
                .position(|candidate| candidate.content_hash == content_hash)
            {
                versions[index] = version;
            } else {
                versions.push(version);
            }
            versions.sort_by(|left, right| right.installed_at.cmp(&left.installed_at));
            let profile = ExtensionProfile {
                id: id.clone(),
                name: prepared.package_name.clone(),
                source_path: format!("npm:{}", prepared.package_name),
                source_kind: ExtensionSourceKind::Npm,
                package_name: Some(prepared.package_name),
                package_version: Some(prepared.version),
                install_path: source_root.display().to_string(),
                integrity_mode: ExtensionIntegrityMode::FullTreeV1,
                enabled: preserve_enabled,
                approved: false,
                content_hash: content_hash.clone(),
                active_version: content_hash,
                versions,
                findings: scan.findings,
                scanned_files: scan.scanned_files,
                scanned_bytes: scan.scanned_bytes,
                created_at: existing
                    .as_ref()
                    .map(|extension| extension.created_at)
                    .unwrap_or(now),
                updated_at: now,
            };
            if let Some(index) = store
                .extensions
                .iter()
                .position(|extension| extension.id == id)
            {
                store.extensions[index] = profile.clone();
            } else {
                store.extensions.push(profile.clone());
            }
            store.version = STORE_VERSION;
            persist(path, &store)?;
            Ok(profile)
        })();
        if result.is_err() && staging_root.exists() {
            let _ = fs::remove_dir_all(staging_root);
        }
        result
    }

    pub fn set_enabled(
        path: &Path,
        id: &str,
        enabled: bool,
        approved_content_hash: Option<&str>,
    ) -> Result<ExtensionProfile, String> {
        let mut store = load(path)?;
        let profile = store
            .extensions
            .iter_mut()
            .find(|extension| extension.id == id)
            .ok_or_else(|| format!("Unknown extension: {id}"))?;
        let version = ExtensionVersion {
            content_hash: profile.content_hash.clone(),
            install_path: profile.install_path.clone(),
            integrity_mode: profile.integrity_mode,
            package_version: profile.package_version.clone(),
            approved: profile.approved,
            findings: profile.findings.clone(),
            scanned_files: profile.scanned_files,
            scanned_bytes: profile.scanned_bytes,
            installed_at: profile.updated_at,
        };
        verify_snapshot(&version)?;
        let elevated = profile.findings.iter().any(|finding| {
            matches!(
                finding.severity,
                FindingSeverity::Warning | FindingSeverity::Critical
            )
        });
        if enabled && elevated {
            if approved_content_hash != Some(profile.content_hash.as_str()) {
                return Err(
                    "Approve the exact active content hash before enabling this extension".into(),
                );
            }
            profile.approved = true;
            if let Some(active) = profile
                .versions
                .iter_mut()
                .find(|version| version.content_hash == profile.content_hash)
            {
                active.approved = true;
            }
        }
        profile.enabled = enabled;
        profile.updated_at = unix_millis()?;
        let result = profile.clone();
        store.version = STORE_VERSION;
        persist(path, &store)?;
        Ok(result)
    }

    pub fn activate_version(
        path: &Path,
        id: &str,
        content_hash: &str,
    ) -> Result<ExtensionProfile, String> {
        let mut store = load(path)?;
        let profile = store
            .extensions
            .iter_mut()
            .find(|extension| extension.id == id)
            .ok_or_else(|| format!("Unknown extension: {id}"))?;
        let version = profile
            .versions
            .iter()
            .find(|version| version.content_hash == content_hash)
            .cloned()
            .ok_or_else(|| format!("Unknown extension version: {content_hash}"))?;
        let has_elevated_findings = version.findings.iter().any(|finding| {
            matches!(
                finding.severity,
                FindingSeverity::Warning | FindingSeverity::Critical
            )
        });
        if profile.enabled && has_elevated_findings && !version.approved {
            return Err(
                "This version was not approved and cannot be activated while enabled".into(),
            );
        }
        verify_snapshot(&version)?;

        profile.install_path = version.install_path;
        profile.integrity_mode = version.integrity_mode;
        profile.package_version = version.package_version;
        profile.approved = version.approved;
        profile.content_hash = version.content_hash.clone();
        profile.active_version = version.content_hash;
        profile.findings = version.findings;
        profile.scanned_files = version.scanned_files;
        profile.scanned_bytes = version.scanned_bytes;
        profile.updated_at = unix_millis()?;
        let result = profile.clone();
        store.version = STORE_VERSION;
        persist(path, &store)?;
        Ok(result)
    }

    pub fn delete(path: &Path, id: &str) -> Result<(), String> {
        let mut store = load(path)?;
        let initial_len = store.extensions.len();
        store.extensions.retain(|extension| extension.id != id);
        if store.extensions.len() == initial_len {
            return Err(format!("Unknown extension: {id}"));
        }
        persist(path, &store)
    }

    pub fn runtime_configs(path: &Path) -> Result<Vec<ExtensionRuntimeConfig>, String> {
        let mut configs = Vec::new();
        for extension in load(path)?.extensions {
            let permitted = extension.enabled
                && (extension.approved
                    || extension
                        .findings
                        .iter()
                        .all(|finding| matches!(finding.severity, FindingSeverity::Info)));
            if !permitted {
                continue;
            }

            let version = ExtensionVersion {
                content_hash: extension.content_hash.clone(),
                install_path: extension.install_path.clone(),
                integrity_mode: extension.integrity_mode,
                package_version: extension.package_version.clone(),
                approved: extension.approved,
                findings: extension.findings.clone(),
                scanned_files: extension.scanned_files,
                scanned_bytes: extension.scanned_bytes,
                installed_at: extension.updated_at,
            };
            verify_snapshot(&version).map_err(|error| {
                format!(
                    "Extension '{}' has an invalid quarantine snapshot: {error}",
                    extension.name
                )
            })?;
            configs.push(ExtensionRuntimeConfig {
                id: extension.id,
                name: extension.name,
                install_path: extension.install_path,
                content_hash: extension.content_hash,
                integrity_mode: extension.integrity_mode,
            });
        }
        Ok(configs)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuarantineManifest<'a> {
    extension_id: &'a str,
    source_path: &'a str,
    content_hash: &'a str,
    installed_at: u64,
    install_scripts_executed: bool,
}

fn install_snapshot(
    source: &Path,
    packages_root: &Path,
    extension_id: &str,
    scan: &ExtensionScanResult,
    installed_at: u64,
) -> Result<String, String> {
    let extension_root = packages_root.join(extension_id);
    let version_root = extension_root.join(&scan.content_hash);
    let source_root = version_root.join("source");
    let runtime_path = if source.is_file() {
        source_root.join(
            source
                .file_name()
                .ok_or_else(|| "Extension file has no filename".to_string())?,
        )
    } else {
        source_root.clone()
    };

    if version_root.exists() {
        let current = scan_path(&runtime_path)?;
        if current.content_hash == scan.content_hash {
            return Ok(runtime_path.display().to_string());
        }
        return Err(format!(
            "Existing quarantine snapshot does not match its content hash: {}",
            version_root.display()
        ));
    }

    create_private_dir(&extension_root)?;
    let staging_root = extension_root.join(format!(".staging-{}", Uuid::new_v4()));
    let staging_source = staging_root.join("source");
    let staging_runtime = if source.is_file() {
        staging_source.join(
            source
                .file_name()
                .ok_or_else(|| "Extension file has no filename".to_string())?,
        )
    } else {
        staging_source.clone()
    };

    let prepared = (|| {
        create_private_dir(&staging_source)?;
        copy_snapshot(source, &staging_source)?;
        let manifest = QuarantineManifest {
            extension_id,
            source_path: &scan.source_path,
            content_hash: &scan.content_hash,
            installed_at,
            install_scripts_executed: false,
        };
        write_private_json(&staging_root.join("quarantine.json"), &manifest)?;
        let staged_scan = scan_path(&staging_runtime)?;
        if staged_scan.content_hash != scan.content_hash {
            return Err("Quarantine copy changed the extension content hash".into());
        }
        Ok(())
    })();

    if let Err(error) = prepared {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error);
    }
    fs::rename(&staging_root, &version_root).map_err(|error| {
        let _ = fs::remove_dir_all(&staging_root);
        format!("activate quarantine snapshot: {error}")
    })?;
    Ok(runtime_path.display().to_string())
}

fn copy_snapshot(source: &Path, destination_root: &Path) -> Result<(), String> {
    if source.is_file() {
        let destination = destination_root.join(
            source
                .file_name()
                .ok_or_else(|| "Extension file has no filename".to_string())?,
        );
        copy_private_file(source, &destination)?;
        return Ok(());
    }

    for file in collect_files(source)? {
        let metadata = fs::symlink_metadata(&file).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = file
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        copy_private_file(&file, &destination_root.join(relative))?;
    }
    Ok(())
}

fn copy_private_file(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        create_private_dir(parent)?;
    }
    fs::copy(source, destination)
        .map_err(|error| format!("copy {} to quarantine: {error}", source.display()))?;
    fs::set_permissions(destination, fs::Permissions::from_mode(0o400))
        .map_err(|error| error.to_string())
}

fn create_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())
}

fn write_private_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let encoded =
        serde_json::to_vec_pretty(value).map_err(|error| format!("serialize manifest: {error}"))?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn verify_snapshot(version: &ExtensionVersion) -> Result<(), String> {
    if version.install_path.trim().is_empty() {
        return Err("legacy extension has no quarantine snapshot; review and save it again".into());
    }
    let current_hash = match version.integrity_mode {
        ExtensionIntegrityMode::ScannableV1 => {
            scan_path(Path::new(&version.install_path))?.content_hash
        }
        ExtensionIntegrityMode::FullTreeV1 => integrity_hash(Path::new(&version.install_path))?,
    };
    if current_hash != version.content_hash {
        return Err("snapshot content hash mismatch".into());
    }
    Ok(())
}

fn scan_path(input: &Path) -> Result<ExtensionScanResult, String> {
    scan_path_with_limits(input, false)
}

fn scan_marketplace_path(input: &Path) -> Result<ExtensionScanResult, String> {
    scan_path_with_limits(input, true)
}

fn scan_path_with_limits(input: &Path, marketplace: bool) -> Result<ExtensionScanResult, String> {
    let source = input
        .canonicalize()
        .map_err(|error| format!("Extension path is unavailable: {error}"))?;
    if !source.is_file() && !source.is_dir() {
        return Err("Extension path must be a file or directory".into());
    }

    let files = if marketplace {
        collect_marketplace_files(&source)?
    } else {
        collect_files(&source)?
    };
    let max_total_bytes = if marketplace {
        MAX_MARKETPLACE_SCAN_BYTES
    } else {
        MAX_TOTAL_BYTES
    };
    let root = if source.is_dir() {
        source.clone()
    } else {
        source
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("/"))
    };
    let mut findings = Vec::new();
    let mut hasher = Sha256::new();
    let mut scanned_bytes = 0_u64;
    let mut capabilities = BTreeSet::new();

    for file in &files {
        let relative = file.strip_prefix(&root).unwrap_or(file);
        let metadata = fs::symlink_metadata(file).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            findings.push(ExtensionFinding {
                severity: FindingSeverity::Warning,
                capability: "symlink".into(),
                message: "Symbolic links are not followed during scanning".into(),
                file: Some(relative.display().to_string()),
            });
            continue;
        }
        if metadata.len() > max_total_bytes {
            return Err(format!("Extension file is too large: {}", file.display()));
        }
        scanned_bytes = scanned_bytes.saturating_add(metadata.len());
        if scanned_bytes > max_total_bytes {
            return Err(format!(
                "Extension scan exceeds the {} byte limit",
                max_total_bytes
            ));
        }

        let content = fs::read(file).map_err(|error| error.to_string())?;
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(&content);
        let text = String::from_utf8_lossy(&content);
        scan_text(&text, relative, &mut findings, &mut capabilities);
        if file.file_name().is_some_and(|name| name == "package.json") {
            scan_package_json(&text, relative, &mut findings)?;
        }
    }

    if files.is_empty() {
        return Err("No JavaScript, TypeScript, JSON, or Markdown files were found".into());
    }
    if findings.is_empty() {
        findings.push(ExtensionFinding {
            severity: FindingSeverity::Info,
            capability: "scan".into(),
            message: "No elevated capability patterns were detected".into(),
            file: None,
        });
    }

    Ok(ExtensionScanResult {
        source_path: source.display().to_string(),
        content_hash: format!("{:x}", hasher.finalize()),
        findings,
        scanned_files: files.len(),
        scanned_bytes,
    })
}

fn collect_marketplace_files(source: &Path) -> Result<Vec<PathBuf>, String> {
    collect_files_with_options(source, MAX_MARKETPLACE_FILES, false)
}

fn collect_files(source: &Path) -> Result<Vec<PathBuf>, String> {
    collect_files_with_options(source, MAX_FILES, true)
}

fn collect_files_with_options(
    source: &Path,
    max_files: usize,
    skip_dist: bool,
) -> Result<Vec<PathBuf>, String> {
    if source.is_file() {
        return Ok(vec![source.to_path_buf()]);
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some("node_modules" | ".git" | "coverage")
            ) && !(skip_dist && entry.file_name().to_str() == Some("dist"))
        })
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_symlink()
            || (entry.file_type().is_file() && is_scannable(entry.path()))
        {
            files.push(entry.into_path());
            if files.len() > max_files {
                return Err(format!("Extension scan exceeds the {max_files} file limit"));
            }
        }
    }
    files.sort();
    Ok(files)
}

fn integrity_hash(source: &Path) -> Result<String, String> {
    let root = source
        .canonicalize()
        .map_err(|error| format!("Package snapshot is unavailable: {error}"))?;
    if !root.is_dir() {
        return Err("Full package snapshot must be a directory".into());
    }
    let mut files = Vec::new();
    let mut total_bytes = 0_u64;
    for entry in WalkDir::new(&root).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            let target = entry
                .path()
                .canonicalize()
                .map_err(|error| format!("Broken package symlink: {error}"))?;
            if !target.starts_with(&root) {
                return Err(format!(
                    "Package symlink escapes the quarantine root: {}",
                    entry.path().display()
                ));
            }
            continue;
        }
        if metadata.is_file() {
            total_bytes = total_bytes.saturating_add(metadata.len());
            if total_bytes > MAX_PACKAGE_BYTES {
                return Err(format!(
                    "Package snapshot exceeds the {} byte limit",
                    MAX_PACKAGE_BYTES
                ));
            }
            files.push(entry.into_path());
            if files.len() > MAX_PACKAGE_FILES {
                return Err(format!(
                    "Package snapshot exceeds the {MAX_PACKAGE_FILES} file limit"
                ));
            }
        }
    }
    if files.is_empty() {
        return Err("Package snapshot contains no files".into());
    }
    files.sort();
    let mut hasher = Sha256::new();
    for file in files {
        let relative = file
            .strip_prefix(&root)
            .map_err(|error| error.to_string())?;
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update([0]);
        let content = fs::read(&file).map_err(|error| error.to_string())?;
        hasher.update(content);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn make_snapshot_readonly(root: &Path) -> Result<(), String> {
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
    directories.sort_by_key(|directory| std::cmp::Reverse(directory.components().count()));
    for directory in directories {
        fs::set_permissions(directory, fs::Permissions::from_mode(0o500))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn is_scannable(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("js" | "mjs" | "cjs" | "ts" | "tsx" | "json" | "md")
    )
}

fn scan_text(
    text: &str,
    file: &Path,
    findings: &mut Vec<ExtensionFinding>,
    capabilities: &mut BTreeSet<String>,
) {
    let patterns = [
        (
            ["child_process", "exec(", "spawn("].as_slice(),
            FindingSeverity::Critical,
            "process-execution",
            "May execute local processes or shell commands",
        ),
        (
            ["writeFile", "appendFile", "createWriteStream"].as_slice(),
            FindingSeverity::Warning,
            "filesystem-write",
            "May write files on the local filesystem",
        ),
        (
            ["fetch(", "http.request", "https.request", "WebSocket"].as_slice(),
            FindingSeverity::Warning,
            "network",
            "May communicate with external network services",
        ),
        (
            ["process.env"].as_slice(),
            FindingSeverity::Warning,
            "environment",
            "May read process environment variables",
        ),
        (
            ["security find-generic-password", "keychain", "Keychain"].as_slice(),
            FindingSeverity::Critical,
            "credentials",
            "May access credentials or macOS Keychain",
        ),
    ];

    for (needles, severity, capability, message) in patterns {
        if needles.iter().any(|needle| text.contains(needle))
            && capabilities.insert(format!("{}:{}", file.display(), capability))
        {
            findings.push(ExtensionFinding {
                severity,
                capability: capability.into(),
                message: message.into(),
                file: Some(file.display().to_string()),
            });
        }
    }
}

fn scan_package_json(
    text: &str,
    file: &Path,
    findings: &mut Vec<ExtensionFinding>,
) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| format!("invalid package.json: {error}"))?;
    let scripts = value.get("scripts").and_then(serde_json::Value::as_object);
    for name in ["preinstall", "install", "postinstall", "prepare"] {
        if scripts.is_some_and(|scripts| scripts.contains_key(name)) {
            findings.push(ExtensionFinding {
                severity: FindingSeverity::Critical,
                capability: "install-script".into(),
                message: format!("package.json declares a {name} script"),
                file: Some(file.display().to_string()),
            });
        }
    }
    Ok(())
}

fn load(path: &Path) -> Result<ExtensionStoreFile, String> {
    if !path.exists() {
        return Ok(ExtensionStoreFile {
            version: STORE_VERSION,
            extensions: Vec::new(),
        });
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(ExtensionStoreFile {
            version: STORE_VERSION,
            extensions: Vec::new(),
        });
    }
    let store: ExtensionStoreFile = serde_json::from_str(&content)
        .map_err(|error| format!("invalid extensions.json: {error}"))?;
    if store.version > STORE_VERSION {
        return Err(format!(
            "extensions.json version {} is newer than supported version {STORE_VERSION}",
            store.version
        ));
    }
    Ok(store)
}

fn persist(path: &Path, store: &ExtensionStoreFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let encoded = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("serialize extension: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn required(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(value.to_string())
    }
}

fn default_source_kind() -> ExtensionSourceKind {
    ExtensionSourceKind::Local
}

fn default_integrity_mode() -> ExtensionIntegrityMode {
    ExtensionIntegrityMode::ScannableV1
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn detects_process_execution_and_install_scripts() {
        let directory = std::env::temp_dir().join(format!("pi-extension-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("temporary extension directory");
        fs::write(
            directory.join("index.ts"),
            "import { spawn } from 'node:child_process'; spawn('echo', ['ok']);",
        )
        .expect("extension source");
        fs::write(
            directory.join("package.json"),
            r#"{"name":"test","scripts":{"postinstall":"node setup.js"}}"#,
        )
        .expect("package manifest");
        symlink("index.ts", directory.join("linked-extension.ts")).expect("extension symlink");

        let result = ExtensionStore::scan(directory.to_str().expect("path")).expect("scan");
        assert!(result
            .findings
            .iter()
            .any(|finding| finding.capability == "process-execution"));
        assert!(result
            .findings
            .iter()
            .any(|finding| finding.capability == "install-script"));
        assert!(result
            .findings
            .iter()
            .any(|finding| finding.capability == "symlink"));

        fs::remove_dir_all(directory).expect("temporary extension cleanup");
    }

    #[test]
    fn binds_approval_to_scanned_content_and_persists_with_private_permissions() {
        let directory =
            std::env::temp_dir().join(format!("pi-extension-approval-{}", Uuid::new_v4()));
        let source = directory.join("extension.ts");
        let store_path = directory.join("state").join("extensions.json");
        let packages_root = directory.join("state").join("packages").join("extensions");
        fs::create_dir_all(&directory).expect("temporary extension directory");
        fs::write(
            &source,
            "import { spawn } from 'node:child_process'; spawn('echo', ['ok']);",
        )
        .expect("extension source");

        let scan = ExtensionStore::scan(source.to_str().expect("path")).expect("scan");
        let rejected = ExtensionStore::save(
            &store_path,
            &packages_root,
            ExtensionDraft {
                id: None,
                name: "Approval Test".into(),
                source_path: source.display().to_string(),
                enabled: true,
                approved: true,
                approved_content_hash: Some("stale-hash".into()),
            },
        );
        assert!(rejected.is_err());

        let saved = ExtensionStore::save(
            &store_path,
            &packages_root,
            ExtensionDraft {
                id: None,
                name: "Approval Test".into(),
                source_path: source.display().to_string(),
                enabled: true,
                approved: true,
                approved_content_hash: Some(scan.content_hash),
            },
        )
        .expect("matching approval should save");
        assert!(saved.approved);
        assert_eq!(
            fs::metadata(&store_path)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            ExtensionStore::runtime_configs(&store_path)
                .expect("runtime configs")
                .into_iter()
                .map(|config| config.install_path)
                .collect::<Vec<_>>(),
            vec![saved.install_path.clone()]
        );
        assert_ne!(saved.install_path, saved.source_path);
        assert_eq!(saved.active_version, saved.content_hash);
        assert_eq!(saved.versions.len(), 1);
        assert!(Path::new(&saved.install_path).exists());

        fs::write(
            &source,
            "import { exec } from 'node:child_process'; exec('changed');",
        )
        .expect("changed extension source");
        assert!(ExtensionStore::runtime_configs(&store_path).is_ok());

        fs::set_permissions(&saved.install_path, fs::Permissions::from_mode(0o600))
            .expect("make snapshot writable for tamper test");
        fs::write(&saved.install_path, "tampered").expect("tampered snapshot");
        assert!(ExtensionStore::runtime_configs(&store_path).is_err());

        fs::remove_dir_all(directory).expect("temporary extension cleanup");
    }

    #[test]
    fn preserves_versions_and_can_roll_back_the_active_snapshot() {
        let directory =
            std::env::temp_dir().join(format!("pi-extension-versions-{}", Uuid::new_v4()));
        let source = directory.join("extension.ts");
        let store_path = directory.join("state").join("extensions.json");
        let packages_root = directory.join("state").join("packages").join("extensions");
        fs::create_dir_all(&directory).expect("temporary extension directory");
        fs::write(&source, "export default function first() {}").expect("first version");

        let first_scan = ExtensionStore::scan(source.to_str().expect("path")).expect("first scan");
        let first = ExtensionStore::save(
            &store_path,
            &packages_root,
            ExtensionDraft {
                id: None,
                name: "Version Test".into(),
                source_path: source.display().to_string(),
                enabled: true,
                approved: false,
                approved_content_hash: None,
            },
        )
        .expect("first version should save");

        fs::write(&source, "export default function second() {}").expect("second version");
        let second = ExtensionStore::save(
            &store_path,
            &packages_root,
            ExtensionDraft {
                id: Some(first.id.clone()),
                name: "Version Test".into(),
                source_path: source.display().to_string(),
                enabled: true,
                approved: false,
                approved_content_hash: None,
            },
        )
        .expect("second version should save");
        assert_eq!(second.versions.len(), 2);
        assert_ne!(second.active_version, first_scan.content_hash);

        let rolled_back =
            ExtensionStore::activate_version(&store_path, &first.id, &first.content_hash)
                .expect("rollback");
        assert_eq!(rolled_back.active_version, first.content_hash);
        assert_eq!(
            ExtensionStore::runtime_configs(&store_path)
                .expect("runtime configs")
                .into_iter()
                .map(|config| config.install_path)
                .collect::<Vec<_>>(),
            vec![first.install_path]
        );

        fs::remove_dir_all(directory).expect("temporary extension cleanup");
    }
}
