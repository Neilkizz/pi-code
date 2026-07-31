CREATE TABLE migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    root TEXT NOT NULL UNIQUE,
    bookmark BLOB,
    trust TEXT NOT NULL DEFAULT 'unknown',
    defaults_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL
) STRICT;

CREATE INDEX tasks_recent_idx
    ON tasks(archived, last_opened_at DESC, updated_at DESC);

CREATE TABLE task_environments (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    cwd TEXT NOT NULL,
    worktree TEXT,
    branch TEXT,
    baseline TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE worktree_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    repository_root TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    baseline TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    detail TEXT,
    timestamp INTEGER NOT NULL
) STRICT;

CREATE INDEX worktree_operations_task_idx
    ON worktree_operations(task_id, timestamp DESC);

CREATE TABLE pi_sessions (
    id INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    branch_id TEXT,
    jsonl_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(task_id, session_id)
) STRICT;

CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    protocol_version INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq > 0),
    kind TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    correlation_id TEXT,
    payload_json TEXT NOT NULL,
    persisted_at INTEGER NOT NULL,
    UNIQUE(worker_id, task_id, seq)
) STRICT;

CREATE INDEX task_events_replay_idx
    ON task_events(task_id, id);

CREATE TABLE task_snapshots (
    task_id TEXT PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES task_events(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    status_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content_ref TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX messages_task_idx ON messages(task_id, created_at);

CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    decision TEXT,
    status TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    decided_at INTEGER
) STRICT;

CREATE INDEX approvals_pending_idx ON approvals(task_id, status);

CREATE TABLE policy_rules (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT,
    matcher_json TEXT NOT NULL,
    effect TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    result TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    timestamp INTEGER NOT NULL
) STRICT;

CREATE INDEX audit_log_time_idx ON audit_log(timestamp DESC);

CREATE TABLE endpoints (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_url TEXT NOT NULL,
    default_model TEXT,
    credential_ref TEXT,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE endpoint_models (
    endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(endpoint_id, model_id)
) STRICT;

CREATE TABLE route_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    current_version TEXT,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE resource_versions (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    install_path TEXT NOT NULL,
    approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
    manifest_json TEXT NOT NULL,
    installed_at INTEGER NOT NULL,
    PRIMARY KEY(resource_id, version)
) STRICT;

CREATE TABLE resource_scopes (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    PRIMARY KEY(resource_id, scope_type, scope_id)
) STRICT;

CREATE TABLE resource_permissions (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    decision TEXT NOT NULL,
    PRIMARY KEY(resource_id, capability)
) STRICT;

CREATE TABLE resource_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE routine_runs (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    reason TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
) STRICT;

CREATE TABLE layouts (
    scope TEXT PRIMARY KEY,
    layout_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE migration_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_kind TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_version INTEGER NOT NULL,
    imported_count INTEGER NOT NULL,
    backup_path TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    UNIQUE(source_kind, source_hash)
) STRICT;
