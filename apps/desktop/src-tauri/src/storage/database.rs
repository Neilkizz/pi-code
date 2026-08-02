use super::{
    app_paths::AppPaths,
    endpoints::{EndpointKind, EndpointProfileView, EndpointStore},
    extensions::{ExtensionProfile, ExtensionStore},
    tasks::{TaskIsolation, TaskRecord, TaskStore},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const LATEST_SCHEMA_VERSION: i64 = 2;
const MIGRATION_001: &str = include_str!("migrations/001_initial.sql");
const MIGRATION_002: &str = include_str!("migrations/002_pinned.sql");
const MAX_LEGACY_STORE_BYTES: u64 = 32 * 1024 * 1024;
static DATABASE_INITIALIZE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInitReport {
    pub schema_version: i64,
    pub imported_sources: usize,
    pub imported_records: usize,
}

#[derive(Debug, Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn initialize(paths: &AppPaths) -> Result<DatabaseInitReport, String> {
        let _initialization = DATABASE_INITIALIZE_LOCK
            .lock()
            .map_err(|_| "Database initialization lock is poisoned".to_string())?;
        paths.ensure().map_err(|error| error.to_string())?;
        ensure_private_database_file(&paths.database_file)?;
        let mut connection = open_connection(&paths.database_file)?;
        migrate(&mut connection, paths)?;
        let import = import_legacy_stores(&mut connection, paths)?;
        fs::set_permissions(&paths.database_file, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("secure SQLite database: {error}"))?;
        Ok(DatabaseInitReport {
            schema_version: LATEST_SCHEMA_VERSION,
            imported_sources: import.sources,
            imported_records: import.records,
        })
    }

    pub fn open(path: impl Into<PathBuf>) -> Result<Self, String> {
        let path = path.into();
        let connection = open_connection(&path)?;
        verify_schema(&connection)?;
        Ok(Self { path })
    }

    pub fn connection(&self) -> Result<Connection, String> {
        let connection = open_connection(&self.path)?;
        verify_schema(&connection)?;
        Ok(connection)
    }
}

pub(crate) fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("open SQLite database {}: {error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("configure SQLite busy timeout: {error}"))?;
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            ",
        )
        .map_err(|error| format!("configure SQLite database: {error}"))?;
    Ok(connection)
}

fn ensure_private_database_file(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("secure application data directory: {error}"))?;
    }
    if !path.exists() {
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| format!("create SQLite database {}: {error}", path.display()))?;
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("secure SQLite database: {error}"))
}

fn migrate(connection: &mut Connection, paths: &AppPaths) -> Result<(), String> {
    let current = schema_version(connection)?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(format!(
            "SQLite schema version {current} is newer than this app supports ({LATEST_SCHEMA_VERSION}). The database was not modified."
        ));
    }
    if current == LATEST_SCHEMA_VERSION {
        return verify_schema(connection);
    }

    let migration_backup = if current > 0 {
        Some(backup_database(connection, paths, current)?)
    } else {
        None
    };

    let result = (|| {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("begin schema migration: {error}"))?;
        if current < 1 {
            transaction
                .execute_batch(MIGRATION_001)
                .map_err(|error| format!("apply SQLite migration 001: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO migrations(version, name, checksum, applied_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        1_i64,
                        "initial",
                        sha256_hex(MIGRATION_001.as_bytes()),
                        unix_millis()?
                    ],
                )
                .map_err(|error| format!("record SQLite migration 001: {error}"))?;
            transaction
                .pragma_update(None, "user_version", 1_i64)
                .map_err(|error| format!("set SQLite schema version: {error}"))?;
        }
        if current < 2 {
            transaction
                .execute_batch(MIGRATION_002)
                .map_err(|error| format!("apply SQLite migration 002: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO migrations(version, name, checksum, applied_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        2_i64,
                        "pinned",
                        sha256_hex(MIGRATION_002.as_bytes()),
                        unix_millis()?
                    ],
                )
                .map_err(|error| format!("record SQLite migration 002: {error}"))?;
            transaction
                .pragma_update(None, "user_version", 2_i64)
                .map_err(|error| format!("set SQLite schema version: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("commit SQLite migration: {error}"))
    })();

    if let Err(error) = result {
        if let Some(backup) = migration_backup {
            return Err(format!(
                "{error}. The pre-migration backup is available at {}",
                backup.display()
            ));
        }
        return Err(error);
    }
    verify_schema(connection)
}

fn verify_schema(connection: &Connection) -> Result<(), String> {
    let current = schema_version(connection)?;
    if current != LATEST_SCHEMA_VERSION {
        return Err(format!(
            "SQLite schema version {current} is not supported; expected {LATEST_SCHEMA_VERSION}"
        ));
    }
    let recorded_checksum: String = connection
        .query_row(
            "SELECT checksum FROM migrations WHERE version = ?1",
            [LATEST_SCHEMA_VERSION],
            |row| row.get(0),
        )
        .map_err(|error| format!("verify SQLite migration ledger: {error}"))?;
    let expected = sha256_hex(MIGRATION_002.as_bytes());
    if recorded_checksum != expected {
        return Err(
            "SQLite migration checksum does not match this build; refusing to continue".into(),
        );
    }
    Ok(())
}

fn schema_version(connection: &Connection) -> Result<i64, String> {
    connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("read SQLite schema version: {error}"))
}

fn backup_database(
    source: &Connection,
    paths: &AppPaths,
    schema_version: i64,
) -> Result<PathBuf, String> {
    let backup_path = paths.backups.join(format!(
        "pi-desktop-schema-{schema_version}-{}.sqlite3",
        unix_millis()?
    ));
    let mut destination = Connection::open(&backup_path)
        .map_err(|error| format!("create pre-migration database backup: {error}"))?;
    {
        let backup = rusqlite::backup::Backup::new(source, &mut destination)
            .map_err(|error| format!("start pre-migration database backup: {error}"))?;
        backup
            .run_to_completion(64, Duration::from_millis(10), None)
            .map_err(|error| format!("write pre-migration database backup: {error}"))?;
    }
    destination
        .close()
        .map_err(|(_, error)| format!("close pre-migration database backup: {error}"))?;
    fs::set_permissions(&backup_path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("secure pre-migration database backup: {error}"))?;
    Ok(backup_path)
}

#[derive(Default)]
struct ImportReport {
    sources: usize,
    records: usize,
}

enum LegacyPayload {
    Tasks(Vec<TaskRecord>),
    Endpoints(Vec<EndpointProfileView>),
    Extensions(Vec<ExtensionProfile>),
}

struct PendingImport {
    kind: &'static str,
    source_path: PathBuf,
    source_hash: String,
    source_version: i64,
    backup_path: PathBuf,
    payload: LegacyPayload,
}

fn import_legacy_stores(
    connection: &mut Connection,
    paths: &AppPaths,
) -> Result<ImportReport, String> {
    let mut pending = Vec::new();
    if let Some(import) = prepare_import(connection, paths, "tasks", &paths.tasks_file, |path| {
        TaskStore::list(path, true).map(LegacyPayload::Tasks)
    })? {
        pending.push(import);
    }
    if let Some(import) = prepare_import(
        connection,
        paths,
        "endpoints",
        &paths.endpoints_file,
        |path| EndpointStore::list(path).map(LegacyPayload::Endpoints),
    )? {
        pending.push(import);
    }
    if let Some(import) = prepare_import(
        connection,
        paths,
        "extensions",
        &paths.extensions_file,
        |path| ExtensionStore::list(path).map(LegacyPayload::Extensions),
    )? {
        pending.push(import);
    }
    if pending.is_empty() {
        return Ok(ImportReport::default());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin legacy store import: {error}"))?;
    let mut report = ImportReport::default();
    for import in pending {
        let imported_count = match &import.payload {
            LegacyPayload::Tasks(tasks) => import_tasks(&transaction, tasks)?,
            LegacyPayload::Endpoints(endpoints) => import_endpoints(&transaction, endpoints)?,
            LegacyPayload::Extensions(extensions) => import_extensions(&transaction, extensions)?,
        };
        transaction
            .execute(
                "INSERT INTO migration_imports(
                    source_kind, source_path, source_hash, source_version,
                    imported_count, backup_path, imported_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    import.kind,
                    import.source_path.display().to_string(),
                    import.source_hash,
                    import.source_version,
                    imported_count as i64,
                    import.backup_path.display().to_string(),
                    unix_millis()?
                ],
            )
            .map_err(|error| format!("record {} JSON import: {error}", import.kind))?;
        report.sources += 1;
        report.records += imported_count;
    }
    transaction
        .commit()
        .map_err(|error| format!("commit legacy store import: {error}"))?;
    Ok(report)
}

fn prepare_import<F>(
    connection: &Connection,
    paths: &AppPaths,
    kind: &'static str,
    source_path: &Path,
    parse: F,
) -> Result<Option<PendingImport>, String>
where
    F: FnOnce(&Path) -> Result<LegacyPayload, String>,
{
    if !source_path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(source_path)
        .map_err(|error| format!("inspect legacy {kind} store: {error}"))?;
    if metadata.len() == 0 {
        return Ok(None);
    }
    if metadata.len() > MAX_LEGACY_STORE_BYTES {
        return Err(format!(
            "Legacy {kind} store exceeds the {} byte migration limit",
            MAX_LEGACY_STORE_BYTES
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(source_path)
        .and_then(|file| {
            file.take(MAX_LEGACY_STORE_BYTES + 1)
                .read_to_end(&mut bytes)
        })
        .map_err(|error| format!("read legacy {kind} store: {error}"))?;
    let source_hash = sha256_hex(&bytes);
    let already_imported = connection
        .query_row(
            "SELECT 1 FROM migration_imports
             WHERE source_kind = ?1 AND source_hash = ?2",
            params![kind, source_hash],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("inspect legacy {kind} import ledger: {error}"))?
        .is_some();
    if already_imported {
        return Ok(None);
    }
    let source_json: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid legacy {kind} JSON: {error}"))?;
    let source_version = source_json
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("Legacy {kind} store has no numeric version"))?;
    let payload = parse(source_path)?;
    let backup_path = paths.backups.join(format!(
        "{kind}-{}.json.migrated-backup",
        &source_hash[..16]
    ));
    create_private_backup(source_path, &backup_path)?;
    Ok(Some(PendingImport {
        kind,
        source_path: source_path.to_path_buf(),
        source_hash,
        source_version,
        backup_path,
        payload,
    }))
}

fn create_private_backup(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Ok(());
    }
    let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(destination)
        .map_err(|error| format!("create legacy store backup: {error}"))?;
    std::io::copy(&mut input, &mut output)
        .map_err(|error| format!("write legacy store backup: {error}"))?;
    output
        .sync_all()
        .map_err(|error| format!("sync legacy store backup: {error}"))?;
    fs::set_permissions(destination, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("secure legacy store backup: {error}"))
}

fn import_tasks(transaction: &Transaction<'_>, tasks: &[TaskRecord]) -> Result<usize, String> {
    for task in tasks {
        let project_id = legacy_project_id(&task.project_root);
        let project_name = Path::new(&task.project_root)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("Local project");
        transaction
            .execute(
                "INSERT INTO projects(
                    id, display_name, root, trust, defaults_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'unknown', '{}', ?4, ?5)
                 ON CONFLICT(root) DO UPDATE SET
                    display_name = excluded.display_name,
                    updated_at = MAX(projects.updated_at, excluded.updated_at)",
                params![
                    project_id,
                    project_name,
                    task.project_root,
                    task.created_at as i64,
                    task.updated_at as i64
                ],
            )
            .map_err(|error| format!("import project for task {}: {error}", task.id))?;
        let persisted_project_id: String = transaction
            .query_row(
                "SELECT id FROM projects WHERE root = ?1",
                [&task.project_root],
                |row| row.get(0),
            )
            .map_err(|error| format!("resolve imported task project: {error}"))?;
        let profile_json = serde_json::to_string(&task.profile)
            .map_err(|error| format!("serialize imported task profile: {error}"))?;
        transaction
            .execute(
                "INSERT INTO tasks(
                    id, project_id, status, title, profile_json, archived,
                    created_at, updated_at, last_opened_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    status = excluded.status,
                    title = excluded.title,
                    profile_json = excluded.profile_json,
                    archived = excluded.archived,
                    updated_at = MAX(tasks.updated_at, excluded.updated_at),
                    last_opened_at = MAX(tasks.last_opened_at, excluded.last_opened_at)",
                params![
                    task.id,
                    persisted_project_id,
                    if task.archived { "archived" } else { "ready" },
                    task.title,
                    profile_json,
                    i64::from(task.archived),
                    task.created_at as i64,
                    task.updated_at as i64,
                    task.last_opened_at as i64
                ],
            )
            .map_err(|error| format!("import task {}: {error}", task.id))?;
        let (environment_kind, worktree_path, branch, baseline) = match &task.isolation {
            TaskIsolation::Worktree => {
                let worktree = task.worktree.as_ref().ok_or_else(|| {
                    format!("Task {} has no persisted worktree metadata", task.id)
                })?;
                (
                    "worktree",
                    Some(worktree.worktree_path.as_str()),
                    Some(worktree.branch.as_str()),
                    Some(worktree.baseline.as_str()),
                )
            }
            TaskIsolation::CurrentCheckout => ("currentCheckout", None, None, None),
            TaskIsolation::ReadOnly => ("readOnly", None, None, None),
        };
        transaction
            .execute(
                "INSERT INTO task_environments(
                    task_id, kind, cwd, worktree, branch, baseline, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(task_id) DO UPDATE SET
                    kind = excluded.kind,
                    cwd = excluded.cwd,
                    worktree = excluded.worktree,
                    branch = excluded.branch,
                    baseline = excluded.baseline,
                    updated_at = MAX(task_environments.updated_at, excluded.updated_at)",
                params![
                    task.id,
                    environment_kind,
                    task.cwd,
                    worktree_path,
                    branch,
                    baseline,
                    task.created_at as i64,
                    task.updated_at as i64
                ],
            )
            .map_err(|error| format!("import environment for task {}: {error}", task.id))?;
    }
    Ok(tasks.len())
}

fn import_endpoints(
    transaction: &Transaction<'_>,
    endpoints: &[EndpointProfileView],
) -> Result<usize, String> {
    for endpoint in endpoints {
        let profile = &endpoint.profile;
        let kind = match profile.kind {
            EndpointKind::OpenaiCompatible => "openai-compatible",
            EndpointKind::AnthropicCompatible => "anthropic-compatible",
            EndpointKind::Ollama => "ollama",
        };
        let config_json = serde_json::to_string(endpoint)
            .map_err(|error| format!("serialize imported endpoint: {error}"))?;
        transaction
            .execute(
                "INSERT INTO endpoints(
                    id, provider_id, name, kind, base_url, default_model,
                    credential_ref, enabled, is_default, config_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    provider_id = excluded.provider_id,
                    name = excluded.name,
                    kind = excluded.kind,
                    base_url = excluded.base_url,
                    default_model = excluded.default_model,
                    credential_ref = excluded.credential_ref,
                    enabled = excluded.enabled,
                    is_default = excluded.is_default,
                    config_json = excluded.config_json,
                    updated_at = MAX(endpoints.updated_at, excluded.updated_at)",
                params![
                    profile.id,
                    profile.provider_id,
                    profile.name,
                    kind,
                    profile.base_url,
                    profile.default_model,
                    profile.credential_ref,
                    i64::from(profile.enabled),
                    i64::from(profile.is_default),
                    config_json,
                    profile.created_at as i64,
                    profile.updated_at as i64
                ],
            )
            .map_err(|error| format!("import endpoint {}: {error}", profile.id))?;
        transaction
            .execute(
                "DELETE FROM endpoint_models WHERE endpoint_id = ?1",
                [&profile.id],
            )
            .map_err(|error| format!("replace endpoint models: {error}"))?;
        for (index, model) in profile.models.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO endpoint_models(
                        endpoint_id, model_id, capabilities_json, sort_order
                     ) VALUES (?1, ?2, '{}', ?3)",
                    params![profile.id, model, index as i64],
                )
                .map_err(|error| format!("import endpoint model {model}: {error}"))?;
        }
    }
    Ok(endpoints.len())
}

fn import_extensions(
    transaction: &Transaction<'_>,
    extensions: &[ExtensionProfile],
) -> Result<usize, String> {
    for extension in extensions {
        let config_json = serde_json::to_string(extension)
            .map_err(|error| format!("serialize imported extension: {error}"))?;
        transaction
            .execute(
                "INSERT INTO resources(
                    id, kind, name, source, current_version, status,
                    config_json, created_at, updated_at
                 ) VALUES (?1, 'pi-extension', ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    source = excluded.source,
                    current_version = excluded.current_version,
                    status = excluded.status,
                    config_json = excluded.config_json,
                    updated_at = MAX(resources.updated_at, excluded.updated_at)",
                params![
                    extension.id,
                    extension.name,
                    extension.source_path,
                    extension.active_version,
                    if extension.enabled {
                        "enabled"
                    } else {
                        "disabled"
                    },
                    config_json,
                    extension.created_at as i64,
                    extension.updated_at as i64
                ],
            )
            .map_err(|error| format!("import extension {}: {error}", extension.id))?;
        transaction
            .execute(
                "INSERT INTO resource_scopes(resource_id, scope_type, scope_id, enabled)
                 VALUES (?1, 'global', '', ?2)
                 ON CONFLICT(resource_id, scope_type, scope_id)
                 DO UPDATE SET enabled = excluded.enabled",
                params![extension.id, i64::from(extension.enabled)],
            )
            .map_err(|error| format!("import extension scope: {error}"))?;
        for version in &extension.versions {
            let manifest_json = serde_json::to_string(version)
                .map_err(|error| format!("serialize extension version: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO resource_versions(
                        resource_id, version, content_hash, install_path,
                        approved, manifest_json, installed_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(resource_id, version) DO UPDATE SET
                        content_hash = excluded.content_hash,
                        install_path = excluded.install_path,
                        approved = excluded.approved,
                        manifest_json = excluded.manifest_json,
                        installed_at = excluded.installed_at",
                    params![
                        extension.id,
                        version.content_hash,
                        version.content_hash,
                        version.install_path,
                        i64::from(version.approved),
                        manifest_json,
                        version.installed_at as i64
                    ],
                )
                .map_err(|error| format!("import extension version: {error}"))?;
        }
        for finding in &extension.findings {
            transaction
                .execute(
                    "INSERT INTO resource_permissions(resource_id, capability, decision)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(resource_id, capability)
                     DO UPDATE SET decision = excluded.decision",
                    params![
                        extension.id,
                        finding.capability,
                        if extension.approved {
                            "approved"
                        } else {
                            "review"
                        }
                    ],
                )
                .map_err(|error| format!("import extension permission: {error}"))?;
        }
    }
    Ok(extensions.len())
}

fn legacy_project_id(root: &str) -> String {
    let digest = sha256_hex(root.as_bytes());
    format!("legacy-project-{}", &digest[..32])
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn unix_millis() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::TaskRuntimeProfile;
    use crate::storage::tasks::TaskDraft;
    use uuid::Uuid;

    fn test_paths() -> AppPaths {
        let root = std::env::temp_dir().join(format!("pi-database-test-{}", Uuid::new_v4()));
        AppPaths {
            logs: root.join("logs"),
            attachments: root.join("attachments"),
            packages: root.join("packages"),
            extension_packages: root.join("packages/extensions"),
            backups: root.join("backups"),
            worktrees: root.join("worktrees"),
            database_file: root.join("pi-desktop.sqlite3"),
            endpoints_file: root.join("endpoints.json"),
            extensions_file: root.join("extensions.json"),
            resources_file: root.join("resources.json"),
            agent_skills: root.join("agent").join("skills"),
            agent_prompts: root.join("agent").join("prompts"),
            connectors_file: root.join("connectors.json"),
            connector_runtime: root.join("connector-runtime"),
            tasks_file: root.join("tasks.json"),
            root,
        }
    }

    #[test]
    fn initializes_private_wal_database_and_verifies_checksum() {
        let paths = test_paths();
        let report = Database::initialize(&paths).expect("initialize database");
        assert_eq!(report.schema_version, LATEST_SCHEMA_VERSION);
        assert_eq!(report.imported_sources, 0);
        let connection = open_connection(&paths.database_file).expect("open database");
        assert_eq!(schema_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
        assert_eq!(
            fs::metadata(&paths.database_file)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn imports_legacy_tasks_once_and_keeps_private_backup() {
        let paths = test_paths();
        paths.ensure().unwrap();
        let project = paths.root.join("project");
        fs::create_dir_all(&project).unwrap();
        let task = TaskStore::save(
            &paths.tasks_file,
            TaskDraft {
                id: None,
                title: Some("Imported task".into()),
                cwd: project.display().to_string(),
                project_root: None,
                isolation: None,
                worktree: None,
                profile: TaskRuntimeProfile {
                    provider_id: None,
                    model_id: None,
                    permission_mode: "ask".into(),
                },
            },
        )
        .unwrap();

        let first = Database::initialize(&paths).unwrap();
        assert_eq!(first.imported_sources, 1);
        assert_eq!(first.imported_records, 1);
        let second = Database::initialize(&paths).unwrap();
        assert_eq!(second.imported_sources, 0);
        assert!(paths.tasks_file.exists());

        let connection = open_connection(&paths.database_file).unwrap();
        let title: String = connection
            .query_row("SELECT title FROM tasks WHERE id = ?1", [&task.id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "Imported task");
        let backup_path: String = connection
            .query_row(
                "SELECT backup_path FROM migration_imports WHERE source_kind = 'tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(Path::new(&backup_path).exists());
        assert_eq!(
            fs::metadata(backup_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn rejects_database_from_a_newer_app_without_modifying_it() {
        let paths = test_paths();
        paths.ensure().unwrap();
        ensure_private_database_file(&paths.database_file).unwrap();
        let connection = open_connection(&paths.database_file).unwrap();
        connection
            .pragma_update(None, "user_version", LATEST_SCHEMA_VERSION + 1)
            .unwrap();
        drop(connection);

        let error = Database::initialize(&paths).unwrap_err();
        assert!(error.contains("newer than this app supports"));
        let connection = open_connection(&paths.database_file).unwrap();
        assert_eq!(
            schema_version(&connection).unwrap(),
            LATEST_SCHEMA_VERSION + 1
        );
        fs::remove_dir_all(paths.root).unwrap();
    }
}
