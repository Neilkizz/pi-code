use super::repository::{
    git_failure, git_stdout, inspect_repository, output_text, run_git, RepositoryInfo,
};
use crate::storage::database::Database;
use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const BRANCH_PREFIX: &str = "pi-desktop/task";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub task_id: String,
    pub repository_root: String,
    pub worktree_path: String,
    pub branch: String,
    pub baseline: String,
    pub dirty: bool,
    pub changed_files: usize,
}

#[derive(Debug, Default)]
pub struct WorktreeManager {
    operation_lock: Mutex<()>,
}

impl WorktreeManager {
    pub fn create(
        &self,
        project_path: &Path,
        task_id: &str,
        worktrees_root: &Path,
        database_path: &Path,
    ) -> Result<WorktreeInfo, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "Worktree manager lock is poisoned".to_string())?;
        let task_uuid =
            Uuid::parse_str(task_id).map_err(|_| "Task id must be a UUID".to_string())?;
        let repository = inspect_repository(project_path)?;
        let repository_root = PathBuf::from(&repository.root);
        let short_task = task_uuid.simple().to_string();
        let branch = format!("{BRANCH_PREFIX}/{}", &short_task[..12]);
        validate_branch(&repository_root, &branch)?;

        create_private_dir(worktrees_root)?;
        let repository_bucket = worktrees_root.join(repository_key(&repository.root));
        create_private_dir(&repository_bucket)?;
        let target = repository_bucket.join(task_uuid.to_string());
        if target.exists() {
            return Err(format!(
                "Worktree target already exists: {}",
                target.display()
            ));
        }

        let args = [
            "worktree",
            "add",
            "-b",
            branch.as_str(),
            target
                .to_str()
                .ok_or_else(|| "Worktree path is not valid UTF-8".to_string())?,
            repository.baseline.as_str(),
        ];
        let output = run_git(&repository_root, &args)?;
        if !output.status.success() {
            record_operation(
                database_path,
                task_id,
                &repository,
                &target,
                &branch,
                "create",
                "failed",
                Some(&git_failure(&args, &output)),
            )?;
            return Err(git_failure(&args, &output));
        }

        let mut result = self.inspect_locked(&target, task_id)?;
        result.repository_root = repository.root.clone();
        result.baseline = repository.baseline.clone();
        if let Err(error) = record_operation(
            database_path,
            task_id,
            &repository,
            &target,
            &branch,
            "create",
            "succeeded",
            None,
        ) {
            let rollback = run_git(
                &repository_root,
                &[
                    "worktree",
                    "remove",
                    target
                        .to_str()
                        .ok_or_else(|| "Worktree path is not valid UTF-8".to_string())?,
                ],
            );
            let _ = run_git(&repository_root, &["branch", "-D", &branch]);
            return match rollback {
                Ok(output) if output.status.success() => Err(format!(
                    "Worktree audit persistence failed and creation was rolled back: {error}"
                )),
                _ => Err(format!(
                    "Worktree audit persistence failed; manual cleanup may be required at {}: {error}",
                    target.display()
                )),
            };
        }
        Ok(result)
    }

    pub fn inspect(&self, worktree_path: &Path, task_id: &str) -> Result<WorktreeInfo, String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "Worktree manager lock is poisoned".to_string())?;
        self.inspect_locked(worktree_path, task_id)
    }

    pub fn remove(
        &self,
        worktree_path: &Path,
        task_id: &str,
        worktrees_root: &Path,
        database_path: &Path,
        delete_branch: bool,
    ) -> Result<(), String> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| "Worktree manager lock is poisoned".to_string())?;
        Uuid::parse_str(task_id).map_err(|_| "Task id must be a UUID".to_string())?;
        let root = worktrees_root
            .canonicalize()
            .map_err(|error| format!("Cannot resolve managed worktree root: {error}"))?;
        let worktree = worktree_path
            .canonicalize()
            .map_err(|error| format!("Cannot resolve worktree: {error}"))?;
        if worktree == root || !worktree.starts_with(&root) {
            return Err("Refusing to remove a worktree outside the managed worktree root".into());
        }
        let info = self.inspect_locked(&worktree, task_id)?;
        if info.dirty {
            return Err(format!(
                "Worktree has {} changed file(s). Export a patch or clean it before removal.",
                info.changed_files
            ));
        }
        let repository = inspect_repository(&worktree)?;
        ensure_registered_worktree(&repository, &worktree)?;
        let worktree_text = worktree
            .to_str()
            .ok_or_else(|| "Worktree path is not valid UTF-8".to_string())?;
        let args = ["worktree", "remove", worktree_text];
        let output = run_git(Path::new(&repository.root), &args)?;
        if !output.status.success() {
            let detail = git_failure(&args, &output);
            record_operation(
                database_path,
                task_id,
                &repository,
                &worktree,
                &info.branch,
                "remove",
                "failed",
                Some(&detail),
            )?;
            return Err(detail);
        }
        if delete_branch {
            let delete = run_git(Path::new(&repository.root), &["branch", "-d", &info.branch])?;
            if !delete.status.success() {
                let detail = git_failure(&["branch", "-d", &info.branch], &delete);
                record_operation(
                    database_path,
                    task_id,
                    &repository,
                    &worktree,
                    &info.branch,
                    "delete-branch",
                    "failed",
                    Some(&detail),
                )?;
                return Err(format!(
                    "Worktree was removed, but its unmerged branch was preserved: {detail}"
                ));
            }
        }
        record_operation(
            database_path,
            task_id,
            &repository,
            &worktree,
            &info.branch,
            "remove",
            "succeeded",
            None,
        )?;
        Ok(())
    }

    fn inspect_locked(&self, worktree_path: &Path, task_id: &str) -> Result<WorktreeInfo, String> {
        let repository = inspect_repository(worktree_path)?;
        let canonical_worktree = worktree_path
            .canonicalize()
            .map_err(|error| format!("Cannot resolve worktree: {error}"))?;
        ensure_registered_worktree(&repository, &canonical_worktree)?;
        let branch_ref = git_stdout(
            &canonical_worktree,
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
        )?;
        let baseline = git_stdout(
            &canonical_worktree,
            &["rev-parse", "--verify", "HEAD^{commit}"],
        )?;
        let status = run_git(
            &canonical_worktree,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?;
        if !status.status.success() {
            return Err(git_failure(
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                &status,
            ));
        }
        let changed_files = status
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .count();
        Ok(WorktreeInfo {
            task_id: task_id.to_string(),
            repository_root: repository.root,
            worktree_path: canonical_worktree.display().to_string(),
            branch: branch_ref,
            baseline,
            dirty: changed_files > 0,
            changed_files,
        })
    }
}

fn validate_branch(repository_root: &Path, branch: &str) -> Result<(), String> {
    let valid = run_git(repository_root, &["check-ref-format", "--branch", branch])?;
    if !valid.status.success() {
        return Err(git_failure(
            &["check-ref-format", "--branch", branch],
            &valid,
        ));
    }
    let reference = format!("refs/heads/{branch}");
    let existing = run_git(
        repository_root,
        &["show-ref", "--verify", "--quiet", &reference],
    )?;
    if existing.status.success() {
        return Err(format!("Worktree branch already exists: {branch}"));
    }
    match existing.status.code() {
        Some(1) => Ok(()),
        _ => Err(git_failure(
            &["show-ref", "--verify", "--quiet", &reference],
            &existing,
        )),
    }
}

fn ensure_registered_worktree(
    repository: &RepositoryInfo,
    expected_path: &Path,
) -> Result<(), String> {
    let output = run_git(
        Path::new(&repository.root),
        &["worktree", "list", "--porcelain", "-z"],
    )?;
    if !output.status.success() {
        return Err(git_failure(
            &["worktree", "list", "--porcelain", "-z"],
            &output,
        ));
    }
    let expected = expected_path.display().to_string();
    let registered = output.stdout.split(|byte| *byte == 0).any(|record| {
        output_text(record)
            .strip_prefix("worktree ")
            .is_some_and(|path| Path::new(path) == expected_path)
    });
    if !registered {
        return Err(format!("Path is not a registered Git worktree: {expected}"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn record_operation(
    database_path: &Path,
    task_id: &str,
    repository: &RepositoryInfo,
    worktree_path: &Path,
    branch: &str,
    action: &str,
    result: &str,
    detail: Option<&str>,
) -> Result<(), String> {
    let connection = Database::open(database_path.to_path_buf())?.connection()?;
    connection
        .execute(
            "INSERT INTO worktree_operations(
                task_id, repository_root, worktree_path, branch, baseline,
                action, result, detail, timestamp
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                task_id,
                repository.root,
                worktree_path.display().to_string(),
                branch,
                repository.baseline,
                action,
                result,
                detail,
                unix_millis()?
            ],
        )
        .map_err(|error| format!("record worktree operation: {error}"))?;
    Ok(())
}

fn create_private_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("secure worktree directory: {error}"))
}

fn repository_key(root: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(root.as_bytes()));
    digest[..20].to_string()
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
    use crate::storage::{app_paths::AppPaths, database::Database};
    use std::fs;

    fn test_paths() -> AppPaths {
        let root = std::env::temp_dir().join(format!("pi-worktree-test-{}", Uuid::new_v4()));
        AppPaths {
            logs: root.join("app/logs"),
            attachments: root.join("app/attachments"),
            packages: root.join("app/packages"),
            extension_packages: root.join("app/packages/extensions"),
            backups: root.join("app/backups"),
            worktrees: root.join("app/worktrees"),
            database_file: root.join("app/pi-desktop.sqlite3"),
            endpoints_file: root.join("app/endpoints.json"),
            extensions_file: root.join("app/extensions.json"),
            resources_file: root.join("app/resources.json"),
            agent_skills: root.join("app/agent").join("skills"),
            agent_prompts: root.join("app/agent").join("prompts"),
            tasks_file: root.join("app/tasks.json"),
            root: root.join("app"),
        }
    }

    fn initialize_repository(root: &Path) {
        fs::create_dir_all(root).unwrap();
        git_stdout(root, &["init"]).unwrap();
        git_stdout(
            root,
            &["config", "user.email", "pi-desktop@example.invalid"],
        )
        .unwrap();
        git_stdout(root, &["config", "user.name", "Pi Desktop Test"]).unwrap();
        fs::write(root.join("shared.txt"), "baseline\n").unwrap();
        git_stdout(root, &["add", "shared.txt"]).unwrap();
        git_stdout(root, &["commit", "-m", "initial"]).unwrap();
    }

    #[test]
    fn creates_two_isolated_worktrees_and_refuses_dirty_removal() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let repository = paths.root.parent().unwrap().join("repository");
        initialize_repository(&repository);
        let manager = WorktreeManager::default();
        let task_a = Uuid::new_v4().to_string();
        let task_b = Uuid::new_v4().to_string();
        let first = manager
            .create(&repository, &task_a, &paths.worktrees, &paths.database_file)
            .unwrap();
        let second = manager
            .create(&repository, &task_b, &paths.worktrees, &paths.database_file)
            .unwrap();
        assert_ne!(first.worktree_path, second.worktree_path);
        assert_ne!(first.branch, second.branch);

        fs::write(
            Path::new(&first.worktree_path).join("shared.txt"),
            "task a\n",
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&second.worktree_path).join("shared.txt")).unwrap(),
            "baseline\n"
        );
        let error = manager
            .remove(
                Path::new(&first.worktree_path),
                &task_a,
                &paths.worktrees,
                &paths.database_file,
                false,
            )
            .unwrap_err();
        assert!(error.contains("changed file"));

        fs::write(
            Path::new(&first.worktree_path).join("shared.txt"),
            "baseline\n",
        )
        .unwrap();
        manager
            .remove(
                Path::new(&first.worktree_path),
                &task_a,
                &paths.worktrees,
                &paths.database_file,
                false,
            )
            .unwrap();
        manager
            .remove(
                Path::new(&second.worktree_path),
                &task_b,
                &paths.worktrees,
                &paths.database_file,
                false,
            )
            .unwrap();
        assert!(!Path::new(&first.worktree_path).exists());
        assert!(!Path::new(&second.worktree_path).exists());
        fs::remove_dir_all(paths.root.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_non_uuid_tasks_and_paths_outside_managed_root() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let repository = paths.root.parent().unwrap().join("repository");
        initialize_repository(&repository);
        let manager = WorktreeManager::default();
        assert!(manager
            .create(
                &repository,
                "not-a-uuid",
                &paths.worktrees,
                &paths.database_file,
            )
            .is_err());
        assert!(manager
            .remove(
                &repository,
                &Uuid::new_v4().to_string(),
                &paths.worktrees,
                &paths.database_file,
                false,
            )
            .is_err());
        fs::remove_dir_all(paths.root.parent().unwrap()).unwrap();
    }
}
