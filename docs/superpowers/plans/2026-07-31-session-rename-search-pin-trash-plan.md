# NEXT-U04: Session Rename/Search/Pin/Trash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session rename, pin, backend search, and trash (archive/restore/permanent-delete) to the Pi Desktop sidebar.

**Architecture:** SQLite migration 002 adds `pinned` column to `tasks` table. Four new Rust Tauri commands (`task_rename`, `task_pin`, `task_search`, `task_delete`) extend `TaskRepository`. Frontend `SessionSidebar` gets context menus, inline rename, and debounced backend search. A new `TrashView` component handles archived task browsing/restore/delete. Protocol types and bridge functions wire it all together.

**Tech Stack:** Rust (rusqlite, Tauri), TypeScript (React), CSS (BEM modifiers)

## Global Constraints

- `LATEST_SCHEMA_VERSION` must bump from 1 → 2
- Task deletion only allowed for archived tasks (`archived == 1`)
- All operations on archived tasks must fail with clear error messages
- Worktree NOT physically deleted on trash — only on permanent delete
- 30-day auto-cleanup deferred to future iteration
- Search uses SQLite `LIKE` (not FTS5) — sufficient for session title/cwd volume
- List ordering: pinned DESC → last_opened_at DESC → updated_at DESC → id ASC
- All new i18n keys must have zh-CN translations
- Commits go directly to `main`

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/desktop/src-tauri/src/storage/migrations/002_pinned.sql` | SQL migration: add `pinned` column + index |
| `apps/desktop/src-tauri/src/storage/database.rs` | Bump `LATEST_SCHEMA_VERSION`, register migration 002 |
| `apps/desktop/src-tauri/src/storage/tasks.rs` | Add `pinned: bool` to `TaskRecord` |
| `apps/desktop/src-tauri/src/storage/task_repository.rs` | Add `rename`, `pin`, `search`, `delete` methods; update `list` ordering; update `RawTask`/`map_task_row`/`persist_record` for `pinned` |
| `apps/desktop/src-tauri/src/lib.rs` | Register 4 new Tauri commands |
| `packages/protocol/src/messages.ts` | Add `pinned` to `PersistedTask` |
| `packages/protocol/src/index.ts` | Re-export new types (if any) |
| `apps/desktop/src/platform/tauri/bridge.ts` | Add `renameTask`, `pinTask`, `searchTasks`, `deleteTask` |
| `apps/desktop/src/features/sessions/SessionSidebar.tsx` | Context menu, inline rename, pinned indicators, backend search debounce |
| `apps/desktop/src/features/sessions/TrashView.tsx` | New: Trash view with restore/delete |
| `apps/desktop/src/i18n/I18nProvider.tsx` | 10 new i18n keys (zh-CN + en-US) |
| `apps/desktop/src/styles.css` | Context menu, pin, rename input, trash view styles |

---

### Task 1: SQLite Migration 002 — Add `pinned` Column

**Files:**
- Create: `apps/desktop/src-tauri/src/storage/migrations/002_pinned.sql`
- Modify: `apps/desktop/src-tauri/src/storage/database.rs:19-20`

**Interfaces:**
- Produces: `pinned INTEGER NOT NULL DEFAULT 0` column on `tasks` table, `tasks_pinned_idx` index

- [ ] **Step 1: Create migration SQL file**

```sql
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tasks_pinned_idx ON tasks(pinned, last_opened_at DESC);
```

- [ ] **Step 2: Bump LATEST_SCHEMA_VERSION and register migration in database.rs**

In `database.rs`, change:
```rust
pub const LATEST_SCHEMA_VERSION: i64 = 1;
```
to:
```rust
pub const LATEST_SCHEMA_VERSION: i64 = 2;
```

Add after `MIGRATION_001` declaration:
```rust
const MIGRATION_002: &str = include_str!("migrations/002_pinned.sql");
```

In the `migrate()` function, add after the `current < 1` block (after line 148):
```rust
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
```

- [ ] **Step 3: Verify migration compiles**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: `Finished dev profile` with no errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/storage/migrations/002_pinned.sql apps/desktop/src-tauri/src/storage/database.rs
git commit -m "feat(db): add pinned column and index to tasks (migration 002)"
```

---

### Task 2: Rust — Update TaskRecord and TaskRepository for `pinned`

**Files:**
- Modify: `apps/desktop/src-tauri/src/storage/tasks.rs:44-59`
- Modify: `apps/desktop/src-tauri/src/storage/task_repository.rs:228-301`

**Interfaces:**
- Consumes: `pinned` column from migration 002
- Produces: `TaskRecord.pinned: bool`, updated `RawTask`, `map_task_row`, `persist_record`, `task_select_sql`

- [ ] **Step 1: Add `pinned` field to `TaskRecord` in tasks.rs**

In `tasks.rs`, add after `pub archived: bool`:
```rust
pub pinned: bool,
```

- [ ] **Step 2: Update `RawTask` struct in task_repository.rs**

Add `pinned: bool` field after `archived: bool`:
```rust
struct RawTask {
    // ... existing fields ...
    pinned: bool,
}
```

- [ ] **Step 3: Update `map_task_row` to read `pinned` column**

In `map_task_row`, change the `archived` line and add `pinned`:
```rust
archived: row.get(9)?,
pinned: row.get(10)?,
```

- [ ] **Step 4: Update `RawTask::decode` to carry `pinned`**

In `decode()`, add `pinned: self.pinned` to the `Ok(TaskRecord { ... })` constructor.

- [ ] **Step 5: Update `task_select_sql` to include `t.pinned`**

Change the SELECT clause to:
```sql
SELECT
    t.id, t.title, e.cwd, p.root, e.kind, e.worktree, e.branch, e.baseline,
    t.profile_json, t.archived, t.pinned, t.created_at, t.updated_at, t.last_opened_at
```

- [ ] **Step 6: Update `list()` ORDER BY**

Change the ORDER BY clause to:
```sql
ORDER BY t.pinned DESC, t.last_opened_at DESC, t.updated_at DESC, t.id ASC
```

- [ ] **Step 7: Update `persist_record` to write `pinned`**

In `persist_record`, update the INSERT to include `pinned`:
```rust
"INSERT INTO tasks(
    id, project_id, status, title, profile_json, archived, pinned,
    created_at, updated_at, last_opened_at
 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
 ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id,
    status = excluded.status,
    title = excluded.title,
    profile_json = excluded.profile_json,
    archived = excluded.archived,
    pinned = excluded.pinned,
    updated_at = excluded.updated_at,
    last_opened_at = excluded.last_opened_at"
```

And add `i64::from(task.pinned)` to the params array after `i64::from(task.archived)`.

- [ ] **Step 8: Update existing test to include `pinned: false`**

In the test `sqlite_is_authoritative_for_new_task_writes`, verify the `pinned` field is `false` on the returned task:
```rust
assert!(!task.pinned);
```

- [ ] **Step 9: Run existing tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Expected: All existing tests pass (including the pinned assertion)

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src-tauri/src/storage/tasks.rs apps/desktop/src-tauri/src/storage/task_repository.rs
git commit -m "feat(db): add pinned field to TaskRecord, update ordering and persistence"
```

---

### Task 3: Rust — Add `rename`, `pin`, `search`, `delete` to TaskRepository

**Files:**
- Modify: `apps/desktop/src-tauri/src/storage/task_repository.rs`

**Interfaces:**
- Consumes: `TaskRecord` with `pinned`, `Database` connection
- Produces: `TaskRepository::rename()`, `TaskRepository::pin()`, `TaskRepository::search()`, `TaskRepository::delete()`

- [ ] **Step 1: Write failing tests**

Add the following test module at the end of `task_repository.rs` (inside `#[cfg(test)] mod tests`):

```rust
#[test]
fn rename_updates_title_and_timestamp() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("rename-project");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Old title".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    let renamed = TaskRepository::rename(
        &paths.database_file,
        &task.id,
        "New title",
    )
    .unwrap();
    assert_eq!(renamed.title, "New title");
    assert!(renamed.updated_at >= task.updated_at);
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn rename_archived_task_fails() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("rename-archived");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Will archive".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    TaskRepository::archive(&paths.database_file, &task.id, true).unwrap();
    let result = TaskRepository::rename(&paths.database_file, &task.id, "New");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("archived"));
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn pin_toggles_pinned_flag() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("pin-project");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Pin me".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    assert!(!task.pinned);

    let pinned = TaskRepository::pin(&paths.database_file, &task.id, true).unwrap();
    assert!(pinned.pinned);

    let unpinned = TaskRepository::pin(&paths.database_file, &task.id, false).unwrap();
    assert!(!unpinned.pinned);
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn pin_archived_task_fails() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("pin-archived");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Archived pin".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    TaskRepository::archive(&paths.database_file, &task.id, true).unwrap();
    let result = TaskRepository::pin(&paths.database_file, &task.id, true);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("archived"));
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn search_matches_title_and_path() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let alpha = paths.root.join("alpha-project");
    let beta = paths.root.join("beta-project");
    fs::create_dir_all(&alpha).unwrap();
    fs::create_dir_all(&beta).unwrap();
    TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Build API".into()),
            cwd: alpha.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Fix UI bug".into()),
            cwd: beta.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();

    let results = TaskRepository::search(&paths.database_file, "API").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Build API");

    let results = TaskRepository::search(&paths.database_file, "alpha").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Build API");

    let results = TaskRepository::search(&paths.database_file, "nonexistent").unwrap();
    assert!(results.is_empty());
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn search_excludes_archived() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("search-archived");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Login fix".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    TaskRepository::archive(&paths.database_file, &task.id, true).unwrap();
    let results = TaskRepository::search(&paths.database_file, "Login").unwrap();
    assert!(results.is_empty());
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn delete_removes_archived_task() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("delete-project");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("To delete".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    TaskRepository::archive(&paths.database_file, &task.id, true).unwrap();
    TaskRepository::delete(&paths.database_file, &task.id).unwrap();
    assert!(TaskRepository::get(&paths.database_file, &task.id)
        .unwrap()
        .is_none());
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn delete_active_task_fails() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("delete-active");
    fs::create_dir_all(&project).unwrap();
    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("Active task".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    let result = TaskRepository::delete(&paths.database_file, &task.id);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("archived"));
    fs::remove_dir_all(paths.root).unwrap();
}

#[test]
fn list_sorts_pinned_first() {
    let paths = test_paths();
    Database::initialize(&paths).unwrap();
    let project = paths.root.join("sort-project");
    fs::create_dir_all(&project).unwrap();
    let a = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("A".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    let b = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: None,
            title: Some("B".into()),
            cwd: project.display().to_string(),
            project_root: None,
            isolation: Some(TaskIsolation::CurrentCheckout),
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        },
    )
    .unwrap();
    TaskRepository::pin(&paths.database_file, &b.id, true).unwrap();

    let tasks = TaskRepository::list(&paths.database_file, false).unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(tasks[0].pinned); // B is pinned, should be first
    assert_eq!(tasks[0].title, "B");
    assert!(!tasks[1].pinned);
    assert_eq!(tasks[1].title, "A");
    fs::remove_dir_all(paths.root).unwrap();
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- rename pin search delete list_sorts
```
Expected: All new tests FAIL — method not found / compile error

- [ ] **Step 3: Implement `rename` method**

```rust
pub fn rename(database_path: &Path, id: &str, title: &str) -> Result<TaskRecord, String> {
    let connection = Database::open(database_path.to_path_buf())?.connection()?;
    let task = get_with_connection(&connection, id)?
        .ok_or_else(|| format!("Unknown task: {id}"))?;
    if task.archived {
        return Err("Cannot rename an archived task".into());
    }
    let now = unix_millis()?;
    connection
        .execute(
            "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3 AND archived = 0",
            params![title, now as i64, id],
        )
        .map_err(|error| format!("rename task: {error}"))?;
    get_with_connection(&connection, id)?
        .ok_or_else(|| format!("Task disappeared after rename: {id}"))
}
```

- [ ] **Step 4: Implement `pin` method**

```rust
pub fn pin(database_path: &Path, id: &str, pinned: bool) -> Result<TaskRecord, String> {
    let connection = Database::open(database_path.to_path_buf())?.connection()?;
    let task = get_with_connection(&connection, id)?
        .ok_or_else(|| format!("Unknown task: {id}"))?;
    if task.archived {
        return Err("Cannot pin an archived task".into());
    }
    connection
        .execute(
            "UPDATE tasks SET pinned = ?1 WHERE id = ?2 AND archived = 0",
            params![i64::from(pinned), id],
        )
        .map_err(|error| format!("pin task: {error}"))?;
    get_with_connection(&connection, id)?
        .ok_or_else(|| format!("Task disappeared after pin: {id}"))
}
```

- [ ] **Step 5: Implement `search` method**

```rust
pub fn search(database_path: &Path, query: &str) -> Result<Vec<TaskRecord>, String> {
    let connection = Database::open(database_path.to_path_buf())?.connection()?;
    let pattern = format!("%{}%", query);
    let sql = task_select_sql(
        "WHERE t.archived = 0 AND (t.title LIKE ?1 OR e.cwd LIKE ?2)",
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("prepare task search: {error}"))?;
    let rows = statement
        .query_map(params![pattern, pattern], map_task_row)
        .map_err(|error| format!("query task search: {error}"))?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(
            row.map_err(|error| format!("read task row: {error}"))?
                .decode()?,
        );
    }
    Ok(tasks)
}
```

- [ ] **Step 6: Implement `delete` method**

```rust
pub fn delete(database_path: &Path, id: &str) -> Result<(), String> {
    let connection = Database::open(database_path.to_path_buf())?.connection()?;
    let task = get_with_connection(&connection, id)?
        .ok_or_else(|| format!("Unknown task: {id}"))?;
    if !task.archived {
        return Err("Cannot delete an active task; archive it first".into());
    }
    connection
        .execute("DELETE FROM tasks WHERE id = ?1 AND archived = 1", params![id])
        .map_err(|error| format!("delete task: {error}"))?;
    Ok(())
}
```

- [ ] **Step 7: Run all tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Expected: All existing tests + 9 new tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/storage/task_repository.rs
git commit -m "feat(db): add rename, pin, search, delete methods to TaskRepository"
```

---

### Task 4: Rust — Register Tauri Commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `TaskRepository::rename`, `pin`, `search`, `delete`
- Produces: `task_rename`, `task_pin`, `task_search`, `task_delete` Tauri commands

- [ ] **Step 1: Add four new Tauri commands in lib.rs**

Add after `task_archive` command (around line 455):

```rust
#[tauri::command]
fn task_rename(
    app: tauri::AppHandle,
    id: String,
    title: String,
) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::rename(&paths.database_file, &id, &title)
}

#[tauri::command]
fn task_pin(
    app: tauri::AppHandle,
    id: String,
    pinned: bool,
) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::pin(&paths.database_file, &id, pinned)
}

#[tauri::command]
fn task_search(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<TaskRecord>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::search(&paths.database_file, &query)
}

#[tauri::command]
fn task_delete(
    app: tauri::AppHandle,
    terminal: tauri::State<'_, TerminalManager>,
    id: String,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    terminal.stop(&id)?;
    TaskRepository::delete(&paths.database_file, &id)
}
```

- [ ] **Step 2: Register commands in the `invoke_handler`**

In the `tauri::Builder::default()` block, add the new commands to the `invoke_handler`:
```rust
task_rename,
task_pin,
task_search,
task_delete,
```

- [ ] **Step 3: Verify compilation**

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Expected: `Finished dev profile` with no errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tauri): add task_rename, task_pin, task_search, task_delete commands"
```

---

### Task 5: Protocol — Add `pinned` to PersistedTask

**Files:**
- Modify: `packages/protocol/src/messages.ts:37-49`

**Interfaces:**
- Produces: `PersistedTask.pinned: boolean`

- [ ] **Step 1: Add `pinned` field to PersistedTask**

In `messages.ts`, add `pinned: boolean;` after `archived: boolean;`:
```ts
export interface PersistedTask {
  // ... existing fields ...
  archived: boolean;
  pinned: boolean;
  // ... remaining fields ...
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/protocol/src/messages.ts
git commit -m "feat(protocol): add pinned field to PersistedTask"
```

---

### Task 6: Bridge — Add Frontend API Functions

**Files:**
- Modify: `apps/desktop/src/platform/tauri/bridge.ts`

**Interfaces:**
- Produces: `renameTask()`, `pinTask()`, `searchTasks()`, `deleteTask()`

- [ ] **Step 1: Add bridge functions**

Add after `archiveTask` (around line 134):

```ts
export async function renameTask(
  id: string,
  title: string,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_rename", { id, title });
}

export async function pinTask(
  id: string,
  pinned: boolean,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_pin", { id, pinned });
}

export async function searchTasks(
  query: string,
): Promise<PersistedTask[]> {
  return invoke<PersistedTask[]>("task_search", { query });
}

export async function deleteTask(
  id: string,
): Promise<void> {
  return invoke("task_delete", { id });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/platform/tauri/bridge.ts
git commit -m "feat(bridge): add renameTask, pinTask, searchTasks, deleteTask"
```

---

### Task 7: i18n — Add Translation Keys

**Files:**
- Modify: `apps/desktop/src/i18n/I18nProvider.tsx`

**Interfaces:**
- Produces: 10 new i18n keys with zh-CN translations

- [ ] **Step 1: Add i18n keys**

Add the following to both the `en` and `zh-CN` translation objects:

| Key | en-US | zh-CN |
|---|---|---|
| `"Rename"` | `"Rename"` | `"重命名"` |
| `"Pin"` | `"Pin"` | `"置顶"` |
| `"Unpin"` | `"Unpin"` | `"取消置顶"` |
| `"Archive"` | `"Archive"` | `"归档"` |
| `"Trash"` | `"Trash"` | `"垃圾桶"` |
| `"Restore"` | `"Restore"` | `"恢复"` |
| `"Delete permanently"` | `"Delete permanently"` | `"永久删除"` |
| `"Are you sure you want to permanently delete this session?"` | `"Are you sure you want to permanently delete this session?"` | `"确定要永久删除此会话吗？"` |
| `"No archived sessions"` | `"No archived sessions"` | `"没有已归档的会话"` |
| `"Archived"` | `"Archived"` | `"已归档"` |

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/i18n/I18nProvider.tsx
git commit -m "feat(i18n): add session rename, pin, trash keys"
```

---

### Task 8: CSS — Add Context Menu, Pin, Rename, Trash Styles

**Files:**
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Produces: CSS classes for context menu, pin icon, rename input, trash view

- [ ] **Step 1: Add CSS styles**

Append to `styles.css`:

```css
/* Session context menu */
.session-link {
  position: relative;
}

.session-link__menu {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-tertiary);
  line-height: 1;
}

.session-link:hover .session-link__menu {
  display: flex;
}

.session-link__menu:hover {
  background: var(--surface-muted);
  color: var(--text);
}

/* Pin indicator */
.session-link__pin {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  margin-right: 2px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* Context menu popover */
.context-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 100;
  min-width: 140px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card, 6px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.context-menu__item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--font-ui-xs);
  cursor: pointer;
  border-radius: 4px;
  text-align: left;
}

.context-menu__item:hover {
  background: var(--surface-muted);
}

.context-menu__item--danger {
  color: var(--danger, #c0392b);
}

/* Inline rename input */
.session-rename-input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: var(--font-ui-xs);
  outline: none;
}

/* Trash view */
.trash-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 12px;
  overflow: auto;
}

.trash-view__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.trash-view__header h2 {
  font-size: var(--font-ui-m);
  font-weight: 680;
  margin: 0;
}

.trash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
  margin-bottom: 6px;
}

.trash-item__info strong {
  font-size: var(--font-ui-s);
  display: block;
}

.trash-item__info small {
  font-size: var(--font-ui-xs);
  color: var(--text-tertiary);
}

.trash-item__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.trash-item__actions button {
  padding: 4px 8px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-ui-xs);
  cursor: pointer;
  border-radius: 4px;
}

.trash-item__actions button:hover {
  background: var(--surface-muted);
  color: var(--text);
}

.trash-item__actions button.trash-item__delete {
  color: var(--danger, #c0392b);
}

.trash-item__actions button.trash-item__delete:hover {
  background: rgba(192, 57, 43, 0.08);
}

/* Confirm dialog overlay */
.confirm-dialog {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 200;
}

.confirm-dialog__box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card, 8px);
  padding: 20px;
  max-width: 360px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.confirm-dialog__box p {
  margin: 0 0 16px;
  font-size: var(--font-ui-s);
  line-height: 1.5;
}

.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-dialog__actions button {
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  font-size: var(--font-ui-xs);
  cursor: pointer;
}

.confirm-dialog__actions button.confirm-dialog__confirm {
  background: var(--danger, #c0392b);
  color: #fff;
  border-color: var(--danger, #c0392b);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "feat(ui): add context menu, pin, rename, trash styles"
```

---

### Task 9: Frontend — TrashView Component

**Files:**
- Create: `apps/desktop/src/features/sessions/TrashView.tsx`

**Interfaces:**
- Consumes: `listTasks(includeArchived: true)`, `archiveTask(id, false)`, `deleteTask(id)`
- Produces: `TrashView` React component

- [ ] **Step 1: Create TrashView component**

```tsx
import { useEffect, useState } from "react";
import type { PersistedTask } from "@pi-desktop/protocol";
import { useI18n } from "../../i18n/I18nProvider";
import { listTasks, archiveTask, deleteTask } from "../../platform/tauri/bridge";
import { compactPath } from "./presentation";

interface TrashViewProps {
  onClose: () => void;
}

export function TrashView({ onClose }: TrashViewProps) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<PersistedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PersistedTask | null>(null);

  useEffect(() => {
    listTasks(true)
      .then((all) => setTasks(all.filter((task) => task.archived)))
      .finally(() => setLoading(false));
  }, []);

  const handleRestore = async (id: string) => {
    await archiveTask(id, false);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
    setDeleteTarget(null);
  };

  return (
    <div className="trash-view">
      <div className="trash-view__header">
        <h2>{t("Trash")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close")}
        >
          ×
        </button>
      </div>

      {loading ? (
        <p>{t("Loading…")}</p>
      ) : tasks.length === 0 ? (
        <p className="session-list__empty">{t("No archived sessions")}</p>
      ) : (
        tasks.map((task) => (
          <div className="trash-item" key={task.id}>
            <div className="trash-item__info">
              <strong>{task.title}</strong>
              <small>
                {compactPath(task.cwd)}
                {" · "}
                {t("Archived")}{" "}
                {new Date(task.updatedAt).toLocaleDateString()}
              </small>
            </div>
            <div className="trash-item__actions">
              <button type="button" onClick={() => handleRestore(task.id)}>
                {t("Restore")}
              </button>
              <button
                type="button"
                className="trash-item__delete"
                onClick={() => setDeleteTarget(task)}
              >
                {t("Delete permanently")}
              </button>
            </div>
          </div>
        ))
      )}

      {deleteTarget ? (
        <div className="confirm-dialog" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <p>
              {t(
                "Are you sure you want to permanently delete this session?",
              )}
            </p>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="confirm-dialog__confirm"
                onClick={() => handleDelete(deleteTarget.id)}
              >
                {t("Delete permanently")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/features/sessions/TrashView.tsx
git commit -m "feat(ui): add TrashView component for archived session management"
```

---

### Task 10: Frontend — SessionSidebar Context Menu + Pin + Search

**Files:**
- Modify: `apps/desktop/src/features/sessions/SessionSidebar.tsx`

**Interfaces:**
- Consumes: `renameTask`, `pinTask`, `searchTasks`, `archiveTask` from bridge; `PersistedTask` with `pinned`
- Produces: Context menu, inline rename, pinned indicators, backend search with debounce, trash link

- [ ] **Step 1: Add imports for new bridge functions and types**

Add to imports:
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  // ... existing imports ...
  renameTask,
  pinTask,
  searchTasks,
} from "../../platform/tauri/bridge";
```

- [ ] **Step 2: Add state and handlers for context menu, rename, search, trash**

Add new state variables inside `SessionSidebar`:
```tsx
const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
const [renameId, setRenameId] = useState<string | null>(null);
const [renameTitle, setRenameTitle] = useState("");
const [isSearching, setIsSearching] = useState(false);
const [searchResults, setSearchResults] = useState<PersistedTask[] | null>(null);
const [showTrash, setShowTrash] = useState(false);
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add `import { TrashView } from "./TrashView";` at the top of the file.

- [ ] **Step 3: Add search handler with debounce**

```tsx
const handleSearchChange = useCallback(
  (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchTasks(value);
        setSearchResults(results);
      } catch {
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    }, 200);
  },
  [],
);
```

- [ ] **Step 4: Add rename, pin, archive handlers**

```tsx
const handleRenameStart = (task: PersistedTask) => {
  setRenameId(task.id);
  setRenameTitle(task.title);
  setMenuTaskId(null);
};

const handleRenameConfirm = async (id: string) => {
  try {
    await renameTask(id, renameTitle);
    setRenameId(null);
    // Trigger parent refresh
    onSelectTask(tasks.find((t) => t.id === id) || tasks[0]);
  } catch {
    // Revert on error
  }
};

const handleRenameCancel = () => {
  setRenameId(null);
};

const handlePin = async (task: PersistedTask) => {
  await pinTask(task.id, !task.pinned);
  setMenuTaskId(null);
  // Trigger parent refresh
  onSelectTask(task);
};

const handleArchive = async (task: PersistedTask) => {
  await archiveTask(task.id, true);
  setMenuTaskId(null);
  // Trigger parent refresh
  onSelectTask(tasks.find((t) => t.id !== task.id) || tasks[0]);
};

	const handleTrashClick = () => {
	  setShowTrash(true);
	};
```

- [ ] **Step 5: Add conditional rendering for TrashView**

At the very top of the component's return block, add:
```tsx
if (showTrash) {
  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <TrashView onClose={() => setShowTrash(false)} />
    </aside>
  );
}
```

- [ ] **Step 6: Update the search input to use debounce handler**

Change:
```tsx
onChange={(event) => setQuery(event.target.value)}
```
to:
```tsx
onChange={(event) => handleSearchChange(event.target.value)}
```

- [ ] **Step 7: Update task list rendering to use search results and show pinned indicator**

Determine which tasks to display:
```tsx
const displayTasks = searchResults ?? visibleTasks;
```

In the task item rendering block, add pinned indicator and context menu button:
```tsx
{group.tasks.map((task) => {
  const runtime = runtimeTasks.find(
    (candidate) => candidate.id === task.id,
  );
  const active = activeView === "tasks" && activeTaskId === task.id;
  return (
    <div className="session-link-wrapper" key={task.id}>
      <button
        className={`session-link ${
          active ? "session-link--active" : ""
        }`}
        type="button"
        onClick={() => onSelectTask(task)}
        aria-pressed={active}
      >
        <span className="session-link__dot" />
        <span>
          <strong>
            {task.pinned ? (
              <span className="session-link__pin" aria-label={t("Pinned")}>
                📌
              </span>
            ) : null}
            {renameId === task.id ? (
              <input
                className="session-rename-input"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameConfirm(task.id);
                  if (e.key === "Escape") handleRenameCancel();
                }}
                onBlur={handleRenameCancel}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              task.title
            )}
          </strong>
          <small title={task.cwd}>{compactPath(task.cwd)}</small>
        </span>
      </button>
      <button
        className="session-link__menu"
        type="button"
        aria-label={t("More actions")}
        onClick={(e) => {
          e.stopPropagation();
          setMenuTaskId(menuTaskId === task.id ? null : task.id);
        }}
      >
        ⋮
      </button>
      {menuTaskId === task.id ? (
        <div className="context-menu">
          <button
            className="context-menu__item"
            type="button"
            onClick={() => handleRenameStart(task)}
          >
            {t("Rename")}
          </button>
          <button
            className="context-menu__item"
            type="button"
            onClick={() => handlePin(task)}
          >
            {task.pinned ? t("Unpin") : t("Pin")}
          </button>
          <button
            className="context-menu__item context-menu__item--danger"
            type="button"
            onClick={() => handleArchive(task)}
          >
            {t("Archive")}
          </button>
        </div>
      ) : null}
    </div>
  );
})}
```

- [ ] **Step 8: Add Trash link at the bottom of the sidebar**

Add after the session list section, before the runtime section:
```tsx
<div className="sidebar__section">
  <button
    className="nav-item"
    type="button"
    onClick={handleTrashClick}
  >
    <NavIcon name="trash" />
    <span>{t("Trash")}</span>
  </button>
</div>
```

- [ ] **Step 9: Run typecheck**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
```
Expected: Zero type errors

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/features/sessions/SessionSidebar.tsx
git commit -m "feat(ui): add context menu, inline rename, pinned indicators, backend search to SessionSidebar"
```

---

### Task 11: Full Verification

**Files:**
- (verification only, no code changes)

- [ ] **Step 1: Run all Rust tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Expected: All tests pass (existing + 9 new)

- [ ] **Step 2: Run all frontend tests**

```bash
npm --prefix apps/desktop run test:unit
```
Expected: All existing tests pass

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
```
Expected: Zero type errors

- [ ] **Step 4: Run cargo fmt check**

```bash
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Expected: No formatting issues

- [ ] **Step 5: Run build**

```bash
npm --prefix apps/desktop run build
```
Expected: Build succeeds

- [ ] **Step 6: Update status document**

Update `docs/pi-desktop-implementation-status.md`:
- Mark NEXT-U03 as ✅ (line 563)
- Mark NEXT-U04 as ✅ (line 564)
- Update Task/Session 持久化 status from "部分" to "完成" (line 172)
- Update Timeline status from "部分" to "完成" (line 174)

- [ ] **Step 7: Commit**

```bash
git add docs/pi-desktop-implementation-status.md
git commit -m "docs: mark NEXT-U03 and NEXT-U04 as complete, update status table"
```

---

## Verification Summary

1. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — all Rust tests pass (including 9 new task_repository tests)
2. `npm --prefix apps/desktop run test:unit` — all frontend tests pass
3. `npx tsc --noEmit -p apps/desktop/tsconfig.json` — zero type errors
4. `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` — formatting clean
5. `npm --prefix apps/desktop run build` — build succeeds
6. GUI smoke: launch .app → Right-click session → Rename/Pin/Archive → Trash view → Restore → Delete permanently → Search