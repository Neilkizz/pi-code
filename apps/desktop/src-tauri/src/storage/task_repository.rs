use super::{
    database::Database,
    tasks::{TaskDraft, TaskIsolation, TaskRecord, TaskStore, TaskWorktree},
};
use crate::agent::protocol::TaskRuntimeProfile;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub struct TaskRepository;

impl TaskRepository {
    pub fn list(database_path: &Path, include_archived: bool) -> Result<Vec<TaskRecord>, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let sql = if include_archived {
            task_select_sql("")
        } else {
            task_select_sql("WHERE t.archived = 0")
        };
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("prepare task list: {error}"))?;
        let rows = statement
            .query_map([], map_task_row)
            .map_err(|error| format!("query task list: {error}"))?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(
                row.map_err(|error| format!("read task row: {error}"))?
                    .decode()?,
            );
        }
        Ok(tasks)
    }

    pub fn get(database_path: &Path, id: &str) -> Result<Option<TaskRecord>, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        get_with_connection(&connection, id)
    }

    pub fn save(database_path: &Path, draft: TaskDraft) -> Result<TaskRecord, String> {
        let mut connection = Database::open(database_path.to_path_buf())?.connection()?;
        let existing = match draft.id.as_deref() {
            Some(id) => get_with_connection(&connection, id)?,
            None => None,
        };
        let record = TaskStore::prepare(draft, existing)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("begin task save: {error}"))?;
        persist_record(&transaction, &record)?;
        transaction
            .commit()
            .map_err(|error| format!("commit task save: {error}"))?;
        Ok(record)
    }

    pub fn touch(database_path: &Path, id: &str) -> Result<TaskRecord, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let task =
            get_with_connection(&connection, id)?.ok_or_else(|| format!("Unknown task: {id}"))?;
        if task.archived {
            return Err(format!("Task is archived: {id}"));
        }
        let now = unix_millis()?;
        connection
            .execute(
                "UPDATE tasks SET last_opened_at = ?1 WHERE id = ?2 AND archived = 0",
                params![now as i64, id],
            )
            .map_err(|error| format!("touch task: {error}"))?;
        get_with_connection(&connection, id)?
            .ok_or_else(|| format!("Task disappeared after touch: {id}"))
    }

    pub fn archive(database_path: &Path, id: &str, archived: bool) -> Result<TaskRecord, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        if get_with_connection(&connection, id)?.is_none() {
            return Err(format!("Unknown task: {id}"));
        }
        let now = unix_millis()?;
        connection
            .execute(
                "UPDATE tasks
                 SET archived = ?1,
                     status = ?2,
                     updated_at = ?3,
                     last_opened_at = CASE WHEN ?1 = 0 THEN ?3 ELSE last_opened_at END
                 WHERE id = ?4",
                params![
                    i64::from(archived),
                    if archived { "archived" } else { "ready" },
                    now as i64,
                    id
                ],
            )
            .map_err(|error| format!("archive task: {error}"))?;
        get_with_connection(&connection, id)?
            .ok_or_else(|| format!("Task disappeared after archive: {id}"))
    }

    pub fn rename(database_path: &Path, id: &str, title: &str) -> Result<TaskRecord, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let task =
            get_with_connection(&connection, id)?.ok_or_else(|| format!("Unknown task: {id}"))?;
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

    pub fn pin(database_path: &Path, id: &str, pinned: bool) -> Result<TaskRecord, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let task =
            get_with_connection(&connection, id)?.ok_or_else(|| format!("Unknown task: {id}"))?;
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

    pub fn search(database_path: &Path, query: &str) -> Result<Vec<TaskRecord>, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let pattern = format!("%{}%", query);
        let sql = task_select_sql("WHERE t.archived = 0 AND (t.title LIKE ?1 OR e.cwd LIKE ?2)");
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

    pub fn delete(database_path: &Path, id: &str) -> Result<(), String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let task =
            get_with_connection(&connection, id)?.ok_or_else(|| format!("Unknown task: {id}"))?;
        if !task.archived {
            return Err("Cannot delete an active task; only archived tasks can be deleted".into());
        }
        connection
            .execute(
                "DELETE FROM tasks WHERE id = ?1 AND archived = 1",
                params![id],
            )
            .map_err(|error| format!("delete task: {error}"))?;
        Ok(())
    }
}

fn get_with_connection(connection: &Connection, id: &str) -> Result<Option<TaskRecord>, String> {
    let sql = task_select_sql("WHERE t.id = ?1");
    let raw = connection
        .query_row(&sql, [id], map_task_row)
        .optional()
        .map_err(|error| format!("query task {id}: {error}"))?;
    raw.map(RawTask::decode).transpose()
}

fn persist_record(transaction: &Transaction<'_>, task: &TaskRecord) -> Result<(), String> {
    let project_id = project_id(&task.project_root);
    let display_name = Path::new(&task.project_root)
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
                display_name,
                task.project_root,
                task.created_at as i64,
                task.updated_at as i64
            ],
        )
        .map_err(|error| format!("persist task project: {error}"))?;
    let persisted_project_id: String = transaction
        .query_row(
            "SELECT id FROM projects WHERE root = ?1",
            [&task.project_root],
            |row| row.get(0),
        )
        .map_err(|error| format!("resolve task project: {error}"))?;
    let profile_json = serde_json::to_string(&task.profile)
        .map_err(|error| format!("serialize task profile: {error}"))?;
    transaction
        .execute(
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
                last_opened_at = excluded.last_opened_at",
            params![
                task.id,
                persisted_project_id,
                if task.archived { "archived" } else { "ready" },
                task.title,
                profile_json,
                i64::from(task.archived),
                i64::from(task.pinned),
                task.created_at as i64,
                task.updated_at as i64,
                task.last_opened_at as i64
            ],
        )
        .map_err(|error| format!("persist task: {error}"))?;
    let (kind, worktree, branch, baseline) = match (&task.isolation, &task.worktree) {
        (TaskIsolation::Worktree, Some(worktree)) => (
            "worktree",
            Some(worktree.worktree_path.as_str()),
            Some(worktree.branch.as_str()),
            Some(worktree.baseline.as_str()),
        ),
        (TaskIsolation::Worktree, None) => {
            return Err("Worktree task has no environment metadata".into())
        }
        (TaskIsolation::CurrentCheckout, _) => ("currentCheckout", None, None, None),
        (TaskIsolation::ReadOnly, _) => ("readOnly", None, None, None),
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
                updated_at = excluded.updated_at",
            params![
                task.id,
                kind,
                task.cwd,
                worktree,
                branch,
                baseline,
                task.created_at as i64,
                task.updated_at as i64
            ],
        )
        .map_err(|error| format!("persist task environment: {error}"))?;
    Ok(())
}

fn task_select_sql(filter: &str) -> String {
    format!(
        "SELECT
            t.id, t.title, e.cwd, p.root, e.kind, e.worktree, e.branch, e.baseline,
            t.profile_json, t.archived, t.pinned, t.created_at, t.updated_at, t.last_opened_at
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         JOIN task_environments e ON e.task_id = t.id
         {filter}
         ORDER BY t.pinned DESC, t.last_opened_at DESC, t.updated_at DESC, t.id ASC"
    )
}

struct RawTask {
    id: String,
    title: String,
    cwd: String,
    project_root: String,
    environment_kind: String,
    worktree_path: Option<String>,
    branch: Option<String>,
    baseline: Option<String>,
    profile_json: String,
    archived: bool,
    pinned: bool,
    created_at: i64,
    updated_at: i64,
    last_opened_at: i64,
}

impl RawTask {
    fn decode(self) -> Result<TaskRecord, String> {
        let isolation = match self.environment_kind.as_str() {
            "worktree" => TaskIsolation::Worktree,
            "currentCheckout" | "local" => TaskIsolation::CurrentCheckout,
            "readOnly" => TaskIsolation::ReadOnly,
            value => return Err(format!("Unsupported persisted task environment: {value}")),
        };
        let worktree = if isolation == TaskIsolation::Worktree {
            Some(TaskWorktree {
                repository_root: self.project_root.clone(),
                worktree_path: self
                    .worktree_path
                    .ok_or_else(|| "Persisted worktree path is missing".to_string())?,
                branch: self
                    .branch
                    .ok_or_else(|| "Persisted worktree branch is missing".to_string())?,
                baseline: self
                    .baseline
                    .ok_or_else(|| "Persisted worktree baseline is missing".to_string())?,
            })
        } else {
            None
        };
        let profile: TaskRuntimeProfile = serde_json::from_str(&self.profile_json)
            .map_err(|error| format!("decode task profile: {error}"))?;
        Ok(TaskRecord {
            id: self.id,
            title: self.title,
            cwd: self.cwd,
            project_root: self.project_root,
            isolation,
            worktree,
            profile,
            archived: self.archived,
            pinned: self.pinned,
            created_at: unsigned_timestamp(self.created_at)?,
            updated_at: unsigned_timestamp(self.updated_at)?,
            last_opened_at: unsigned_timestamp(self.last_opened_at)?,
        })
    }
}

fn map_task_row(row: &Row<'_>) -> rusqlite::Result<RawTask> {
    Ok(RawTask {
        id: row.get(0)?,
        title: row.get(1)?,
        cwd: row.get(2)?,
        project_root: row.get(3)?,
        environment_kind: row.get(4)?,
        worktree_path: row.get(5)?,
        branch: row.get(6)?,
        baseline: row.get(7)?,
        profile_json: row.get(8)?,
        archived: row.get(9)?,
        pinned: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        last_opened_at: row.get(13)?,
    })
}

fn project_id(root: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(root.as_bytes()));
    format!("project-{}", &digest[..32])
}

fn unsigned_timestamp(value: i64) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| "Persisted task timestamp is negative".into())
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
    use crate::storage::{app_paths::AppPaths, database::Database};
    use std::fs;
    use uuid::Uuid;

    fn test_paths() -> AppPaths {
        let root = std::env::temp_dir().join(format!("pi-task-repository-test-{}", Uuid::new_v4()));
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
            tasks_file: root.join("tasks.json"),
            root,
        }
    }

    #[test]
    fn sqlite_is_authoritative_for_new_task_writes() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let project = paths.root.join("project");
        fs::create_dir_all(&project).unwrap();
        let task = TaskRepository::save(
            &paths.database_file,
            TaskDraft {
                id: None,
                title: Some("SQLite task".into()),
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
        assert!(!paths.tasks_file.exists());
        assert!(!task.pinned);
        assert_eq!(
            TaskRepository::list(&paths.database_file, false)
                .unwrap()
                .first()
                .unwrap()
                .id,
            task.id
        );
        let touched = TaskRepository::touch(&paths.database_file, &task.id).unwrap();
        assert!(touched.last_opened_at >= task.last_opened_at);
        TaskRepository::archive(&paths.database_file, &task.id, true).unwrap();
        assert!(TaskRepository::list(&paths.database_file, false)
            .unwrap()
            .is_empty());
        assert_eq!(
            TaskRepository::list(&paths.database_file, true)
                .unwrap()
                .len(),
            1
        );
        fs::remove_dir_all(paths.root).unwrap();
    }

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
        let renamed = TaskRepository::rename(&paths.database_file, &task.id, "New title").unwrap();
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
        assert!(tasks[0].pinned);
        assert_eq!(tasks[0].title, "B");
        assert!(!tasks[1].pinned);
        assert_eq!(tasks[1].title, "A");
        fs::remove_dir_all(paths.root).unwrap();
    }
}
