use crate::agent::protocol::TaskRuntimeProfile;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[cfg(test)]
use std::{
    fs::OpenOptions,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
};

const STORE_VERSION: u32 = 3;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskIsolation {
    Worktree,
    CurrentCheckout,
    ReadOnly,
}

impl Default for TaskIsolation {
    fn default() -> Self {
        Self::CurrentCheckout
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorktree {
    pub repository_root: String,
    pub worktree_path: String,
    pub branch: String,
    pub baseline: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub title: String,
    pub cwd: String,
    #[serde(default)]
    pub project_root: String,
    #[serde(default)]
    pub isolation: TaskIsolation,
    #[serde(default)]
    pub worktree: Option<TaskWorktree>,
    pub profile: TaskRuntimeProfile,
    pub archived: bool,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_opened_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDraft {
    pub id: Option<String>,
    pub title: Option<String>,
    pub cwd: String,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub isolation: Option<TaskIsolation>,
    #[serde(default)]
    pub worktree: Option<TaskWorktree>,
    pub profile: TaskRuntimeProfile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateDraft {
    pub title: Option<String>,
    pub project_path: String,
    pub isolation: TaskIsolation,
    pub profile: TaskRuntimeProfile,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskStoreFile {
    version: u32,
    tasks: Vec<TaskRecord>,
}

pub struct TaskStore;

impl TaskStore {
    pub fn list(path: &Path, include_archived: bool) -> Result<Vec<TaskRecord>, String> {
        let mut tasks = load(path)?.tasks;
        if !include_archived {
            tasks.retain(|task| !task.archived);
        }
        tasks.sort_by(|left, right| {
            right
                .last_opened_at
                .cmp(&left.last_opened_at)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(tasks)
    }

    #[cfg(test)]
    pub fn save(path: &Path, draft: TaskDraft) -> Result<TaskRecord, String> {
        let mut store = load(path)?;
        let existing = draft
            .id
            .as_ref()
            .and_then(|id| store.tasks.iter().find(|task| &task.id == id))
            .cloned();
        let record = Self::prepare(draft, existing)?;
        let id = record.id.clone();

        if let Some(index) = store.tasks.iter().position(|task| task.id == id) {
            store.tasks[index] = record.clone();
        } else {
            store.tasks.push(record.clone());
        }
        store.version = STORE_VERSION;
        persist(path, &store)?;
        Ok(record)
    }

    pub(crate) fn prepare(
        draft: TaskDraft,
        existing: Option<TaskRecord>,
    ) -> Result<TaskRecord, String> {
        let now = unix_millis()?;
        let id = match draft.id {
            Some(id) => {
                Uuid::parse_str(&id).map_err(|_| "Task id must be a UUID".to_string())?;
                id
            }
            None => Uuid::new_v4().to_string(),
        };
        let cwd = canonical_project_dir(&draft.cwd)?;
        let project_root = canonical_project_dir(
            draft
                .project_root
                .as_deref()
                .unwrap_or_else(|| cwd.to_str().unwrap_or_default()),
        )?;
        let isolation = draft.isolation.unwrap_or_default();
        let worktree = normalize_worktree(&id, &cwd, &project_root, &isolation, draft.worktree)?;
        let profile = normalize_profile(draft.profile)?;
        if isolation == TaskIsolation::ReadOnly && profile.permission_mode != "plan" {
            return Err("Read-only tasks must use Plan permission mode".into());
        }
        let title = draft
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| project_title(&project_root));

        Ok(TaskRecord {
            id: id.clone(),
            title,
            cwd: cwd.display().to_string(),
            project_root: project_root.display().to_string(),
            isolation,
            worktree,
            profile,
            archived: existing.as_ref().is_some_and(|task| task.archived),
            pinned: existing.as_ref().is_some_and(|task| task.pinned),
            created_at: existing.as_ref().map(|task| task.created_at).unwrap_or(now),
            updated_at: now,
            last_opened_at: existing
                .as_ref()
                .map(|task| task.last_opened_at)
                .unwrap_or(now),
        })
    }

    #[cfg(test)]
    pub fn archive(path: &Path, id: &str, archived: bool) -> Result<TaskRecord, String> {
        let mut store = load(path)?;
        let task = store
            .tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("Unknown task: {id}"))?;
        let now = unix_millis()?;
        task.archived = archived;
        task.updated_at = now;
        if !archived {
            task.last_opened_at = now;
        }
        let result = task.clone();
        persist(path, &store)?;
        Ok(result)
    }
}

fn load(path: &Path) -> Result<TaskStoreFile, String> {
    if !path.exists() {
        return Ok(TaskStoreFile {
            version: STORE_VERSION,
            tasks: Vec::new(),
        });
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(TaskStoreFile {
            version: STORE_VERSION,
            tasks: Vec::new(),
        });
    }
    let mut store: TaskStoreFile =
        serde_json::from_str(&content).map_err(|error| format!("invalid tasks.json: {error}"))?;
    if store.version > STORE_VERSION {
        return Err(format!(
            "tasks.json version {} is newer than supported version {STORE_VERSION}",
            store.version
        ));
    }
    for task in &mut store.tasks {
        task.profile.permission_mode = migrate_permission_mode(&task.profile.permission_mode);
        if task.project_root.trim().is_empty() {
            task.project_root = task.cwd.clone();
        }
    }
    store.version = STORE_VERSION;
    Ok(store)
}

#[cfg(test)]
fn persist(path: &Path, store: &TaskStoreFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let encoded =
        serde_json::to_vec_pretty(store).map_err(|error| format!("serialize tasks: {error}"))?;
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

fn canonical_project_dir(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Project folder is required".into());
    }
    let path = fs::canonicalize(trimmed)
        .map_err(|error| format!("Cannot open project folder {trimmed}: {error}"))?;
    if !path.is_dir() {
        return Err(format!(
            "Project folder is not a directory: {}",
            path.display()
        ));
    }
    Ok(path)
}

fn project_title(cwd: &Path) -> String {
    cwd.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Local project")
        .to_string()
}

fn normalize_profile(profile: TaskRuntimeProfile) -> Result<TaskRuntimeProfile, String> {
    if profile.permission_mode == "auto" {
        return Err("Auto mode is disabled until a strong isolation backend is active".to_string());
    }
    if profile.permission_mode != "ask"
        && profile.permission_mode != "acceptEdits"
        && profile.permission_mode != "plan"
    {
        return Err(format!(
            "Unsupported permission mode: {}",
            profile.permission_mode
        ));
    }
    let provider_id = profile
        .provider_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let model_id = profile
        .model_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if provider_id.is_some() != model_id.is_some() {
        return Err("Provider and model must be selected together".into());
    }
    Ok(TaskRuntimeProfile {
        provider_id,
        model_id,
        permission_mode: profile.permission_mode,
    })
}

fn normalize_worktree(
    task_id: &str,
    cwd: &Path,
    project_root: &Path,
    isolation: &TaskIsolation,
    worktree: Option<TaskWorktree>,
) -> Result<Option<TaskWorktree>, String> {
    match isolation {
        TaskIsolation::Worktree => {
            let worktree = worktree
                .ok_or_else(|| "Worktree isolation requires Core-created metadata".to_string())?;
            let worktree_path = canonical_project_dir(&worktree.worktree_path)?;
            let repository_root = canonical_project_dir(&worktree.repository_root)?;
            if worktree_path != cwd {
                return Err("Task cwd does not match its managed worktree".into());
            }
            if repository_root != project_root {
                return Err("Task project root does not match its worktree repository".into());
            }
            if worktree.branch.trim().is_empty() || worktree.baseline.trim().is_empty() {
                return Err("Worktree branch and baseline are required".into());
            }
            if !worktree.branch.contains(&task_id.replace('-', "")[..12]) {
                return Err("Worktree branch is not bound to this task id".into());
            }
            Ok(Some(TaskWorktree {
                repository_root: repository_root.display().to_string(),
                worktree_path: worktree_path.display().to_string(),
                branch: worktree.branch,
                baseline: worktree.baseline,
            }))
        }
        TaskIsolation::CurrentCheckout | TaskIsolation::ReadOnly => {
            if worktree.is_some() {
                return Err("Non-worktree tasks cannot attach worktree metadata".into());
            }
            if cwd != project_root {
                return Err(
                    "Current checkout and read-only tasks must use the project root".into(),
                );
            }
            Ok(None)
        }
    }
}

fn migrate_permission_mode(value: &str) -> String {
    match value {
        "manual" | "auto" => "ask".into(),
        value => value.into(),
    }
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

    fn draft(cwd: &Path) -> TaskDraft {
        TaskDraft {
            id: None,
            title: None,
            cwd: cwd.display().to_string(),
            project_root: None,
            isolation: None,
            worktree: None,
            profile: TaskRuntimeProfile {
                provider_id: None,
                model_id: None,
                permission_mode: "ask".into(),
            },
        }
    }

    #[test]
    fn persists_canonical_task_metadata_with_private_permissions() {
        let root = std::env::temp_dir().join(format!("pi-task-test-{}", Uuid::new_v4()));
        let project = root.join("sample-project");
        fs::create_dir_all(&project).unwrap();
        let path = root.join("tasks.json");

        let saved = TaskStore::save(&path, draft(&project)).unwrap();
        assert_eq!(saved.title, "sample-project");
        assert_eq!(
            saved.cwd,
            fs::canonicalize(&project).unwrap().display().to_string()
        );
        assert!(Uuid::parse_str(&saved.id).is_ok());
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lists_recent_tasks_first_and_filters_archived_records() {
        let root = std::env::temp_dir().join(format!("pi-task-test-{}", Uuid::new_v4()));
        let first_project = root.join("first");
        let second_project = root.join("second");
        fs::create_dir_all(&first_project).unwrap();
        fs::create_dir_all(&second_project).unwrap();
        let path = root.join("tasks.json");

        let first = TaskStore::save(&path, draft(&first_project)).unwrap();
        let second = TaskStore::save(&path, draft(&second_project)).unwrap();
        let mut store = load(&path).unwrap();
        store
            .tasks
            .iter_mut()
            .find(|task| task.id == first.id)
            .unwrap()
            .last_opened_at = second.last_opened_at + 1;
        persist(&path, &store).unwrap();
        let listed = TaskStore::list(&path, false).unwrap();
        assert_eq!(listed[0].id, first.id);
        assert_eq!(listed[1].id, second.id);

        TaskStore::archive(&path, &first.id, true).unwrap();
        assert_eq!(TaskStore::list(&path, false).unwrap().len(), 1);
        assert_eq!(TaskStore::list(&path, true).unwrap().len(), 2);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_creation_time_when_updating_existing_task() {
        let root = std::env::temp_dir().join(format!("pi-task-test-{}", Uuid::new_v4()));
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let path = root.join("tasks.json");
        let original = TaskStore::save(&path, draft(&project)).unwrap();

        let updated = TaskStore::save(
            &path,
            TaskDraft {
                id: Some(original.id.clone()),
                title: Some("Renamed".into()),
                ..draft(&project)
            },
        )
        .unwrap();
        assert_eq!(updated.created_at, original.created_at);
        assert_eq!(updated.title, "Renamed");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_files_and_invalid_runtime_profiles() {
        let root = std::env::temp_dir().join(format!("pi-task-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("file.txt");
        fs::write(&file, "not a directory").unwrap();
        let path = root.join("tasks.json");
        assert!(TaskStore::save(&path, draft(&file)).is_err());

        let mut invalid = draft(&root);
        invalid.profile.provider_id = Some("provider".into());
        assert!(TaskStore::save(&path, invalid).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migrates_legacy_manual_and_unsafe_auto_modes_to_ask() {
        let root = std::env::temp_dir().join(format!("pi-task-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("tasks.json");
        let task_id = Uuid::new_v4().to_string();
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "tasks": [{
                    "id": task_id,
                    "title": "Legacy",
                    "cwd": root.display().to_string(),
                    "profile": {
                        "permissionMode": "auto"
                    },
                    "archived": false,
                    "createdAt": 1,
                    "updatedAt": 1,
                    "lastOpenedAt": 1
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let tasks = TaskStore::list(&path, false).unwrap();
        assert_eq!(tasks[0].profile.permission_mode, "ask");

        fs::remove_dir_all(root).unwrap();
    }
}
