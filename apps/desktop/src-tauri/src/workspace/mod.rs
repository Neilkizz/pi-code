use crate::{
    git::repository::{git_failure, inspect_repository, run_git},
    storage::task_repository::TaskRepository,
};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::{DirEntry, WalkDir};

pub(crate) mod apply;

pub use apply::WorkspacePatchResult;

const MAX_WORKSPACE_FILES: usize = 2_500;
const MAX_FILE_BYTES: usize = 1024 * 1024;
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub task_id: String,
    pub root: String,
    pub is_git: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub changes: Vec<WorkspaceChange>,
    pub files: Vec<WorkspaceFileEntry>,
    pub files_truncated: bool,
    pub generated_at: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub size: u64,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiff {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub content: String,
    pub truncated: bool,
    pub generated_at: u64,
}

pub fn snapshot(database_path: &Path, task_id: &str) -> Result<WorkspaceSnapshot, String> {
    let root = task_root(database_path, task_id)?;
    let (files, files_truncated) = list_files(&root)?;
    let repository = inspect_repository(&root).ok();
    let (branch, head, changes) = match repository {
        Some(repository) => {
            let branch = repository.current_branch;
            let head = Some(repository.baseline);
            let changes = git_changes(&root)?;
            (branch, head, changes)
        }
        None => (None, None, Vec::new()),
    };
    Ok(WorkspaceSnapshot {
        task_id: task_id.to_string(),
        root: root.display().to_string(),
        is_git: head.is_some(),
        branch,
        head,
        changes,
        files,
        files_truncated,
        generated_at: unix_millis()?,
    })
}

pub fn read_file(
    database_path: &Path,
    task_id: &str,
    relative_path: &str,
) -> Result<WorkspaceFileContent, String> {
    let root = task_root(database_path, task_id)?;
    let (relative, file) = resolve_existing_file(&root, relative_path)?;
    let metadata = fs::metadata(&file)
        .map_err(|error| format!("Cannot inspect {}: {error}", file.display()))?;
    if !metadata.is_file() {
        return Err(format!("Workspace path is not a file: {relative}"));
    }
    let mut bytes = fs::read(&file)
        .map_err(|error| format!("Cannot read workspace file {relative}: {error}"))?;
    let truncated = bytes.len() > MAX_FILE_BYTES;
    if truncated {
        bytes.truncate(MAX_FILE_BYTES);
    }
    let binary = bytes.iter().take(8 * 1024).any(|byte| *byte == 0);
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(WorkspaceFileContent {
        path: relative.clone(),
        content,
        language: language_for_path(Path::new(&relative)).to_string(),
        size: metadata.len(),
        binary,
        truncated,
    })
}

pub fn diff(
    database_path: &Path,
    task_id: &str,
    relative_path: Option<&str>,
) -> Result<WorkspaceDiff, String> {
    let root = task_root(database_path, task_id)?;
    inspect_repository(&root)?;
    let normalized_path = relative_path.map(validate_relative_path).transpose()?;

    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--find-renames",
        "--unified=4",
        "HEAD",
        "--",
    ];
    if let Some(path) = normalized_path.as_deref() {
        args.push(path);
    }
    let output = run_git(&root, &args)?;
    if !output.status.success() {
        return Err(git_failure(&args, &output));
    }
    let mut bytes = output.stdout;

    let changes = git_changes(&root)?;
    for change in changes
        .iter()
        .filter(|change| change.status == "untracked")
        .filter(|change| {
            normalized_path
                .as_ref()
                .map(|path| path == &change.path)
                .unwrap_or(true)
        })
    {
        if bytes.len() >= MAX_DIFF_BYTES {
            break;
        }
        let file = root.join(&change.path);
        bytes.extend_from_slice(render_untracked_diff(&change.path, &file)?.as_bytes());
    }

    let truncated = bytes.len() > MAX_DIFF_BYTES;
    if truncated {
        bytes.truncate(MAX_DIFF_BYTES);
    }
    Ok(WorkspaceDiff {
        path: normalized_path,
        content: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
        generated_at: unix_millis()?,
    })
}

pub(super) fn task_root(database_path: &Path, task_id: &str) -> Result<PathBuf, String> {
    let task = TaskRepository::get(database_path, task_id)?
        .ok_or_else(|| format!("Unknown task: {task_id}"))?;
    if task.archived {
        return Err(format!("Task is archived: {task_id}"));
    }
    let root = PathBuf::from(task.cwd)
        .canonicalize()
        .map_err(|error| format!("Cannot resolve task workspace: {error}"))?;
    if !root.is_dir() {
        return Err("Task workspace is not a directory".into());
    }
    Ok(root)
}

fn list_files(root: &Path) -> Result<(Vec<WorkspaceFileEntry>, bool), String> {
    let mut files = Vec::new();
    let mut truncated = false;
    let walker = WalkDir::new(root)
        .follow_links(false)
        .max_depth(14)
        .into_iter()
        .filter_entry(should_visit);
    for entry in walker {
        let entry = entry.map_err(|error| format!("Cannot scan workspace: {error}"))?;
        if !entry.file_type().is_file() {
            continue;
        }
        if files.len() >= MAX_WORKSPACE_FILES {
            truncated = true;
            break;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Workspace scanner crossed the task root".to_string())?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
        files.push(WorkspaceFileEntry {
            path: path_text(relative),
            size: metadata.len(),
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((files, truncated))
}

fn should_visit(entry: &DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return true;
    }
    !matches!(
        entry.file_name().to_string_lossy().as_ref(),
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".turbo"
            | "coverage"
    )
}

pub(super) fn git_changes(root: &Path) -> Result<Vec<WorkspaceChange>, String> {
    let args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
    let output = run_git(root, &args)?;
    if !output.status.success() {
        return Err(git_failure(&args, &output));
    }
    parse_porcelain(&output.stdout)
}

fn parse_porcelain(bytes: &[u8]) -> Result<Vec<WorkspaceChange>, String> {
    let records: Vec<&[u8]> = bytes
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        if record.len() < 4 || record[2] != b' ' {
            return Err("Git returned an invalid porcelain status record".into());
        }
        let x = record[0] as char;
        let y = record[1] as char;
        if x == '!' && y == '!' {
            index += 1;
            continue;
        }
        let path = String::from_utf8_lossy(&record[3..]).into_owned();
        let rename = matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C');
        let old_path = if rename {
            index += 1;
            Some(
                records
                    .get(index)
                    .ok_or_else(|| "Git rename status is missing its source path".to_string())
                    .map(|path| String::from_utf8_lossy(path).into_owned())?,
            )
        } else {
            None
        };
        if !is_generated_path(&path) {
            changes.push(WorkspaceChange {
                path,
                old_path,
                status: change_status(x, y).to_string(),
                staged: x != ' ' && x != '?',
                unstaged: y != ' ' || (x == '?' && y == '?'),
            });
        }
        index += 1;
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

fn change_status(x: char, y: char) -> &'static str {
    if x == '?' && y == '?' {
        "untracked"
    } else if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        "conflicted"
    } else if x == 'R' || y == 'R' {
        "renamed"
    } else if x == 'C' || y == 'C' {
        "copied"
    } else if x == 'A' || y == 'A' {
        "added"
    } else if x == 'D' || y == 'D' {
        "deleted"
    } else {
        "modified"
    }
}

fn is_generated_path(path: &str) -> bool {
    matches!(
        path.split('/').next().unwrap_or(path),
        "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo" | "coverage"
    )
}

pub(super) fn resolve_existing_file(
    root: &Path,
    relative_path: &str,
) -> Result<(String, PathBuf), String> {
    let relative = validate_relative_path(relative_path)?;
    let path = root.join(&relative);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve workspace file {relative}: {error}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err("Workspace file resolves outside the task root".into());
    }
    Ok((relative, canonical))
}

pub(super) fn validate_relative_path(relative_path: &str) -> Result<String, String> {
    if relative_path.trim().is_empty() {
        return Err("Workspace path cannot be empty".into());
    }
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Workspace path must be a normalized relative path".into());
    }
    Ok(path_text(path))
}

fn render_untracked_diff(relative: &str, path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Cannot read untracked file {relative}: {error}"))?;
    if bytes.iter().take(8 * 1024).any(|byte| *byte == 0) {
        return Ok(format!(
            "\ndiff --git a/{relative} b/{relative}\nnew file mode 100644\nBinary files /dev/null and b/{relative} differ\n"
        ));
    }
    let text = String::from_utf8_lossy(&bytes);
    let line_count = text.lines().count();
    let mut result = format!(
        "\ndiff --git a/{relative} b/{relative}\nnew file mode 100644\n--- /dev/null\n+++ b/{relative}\n@@ -0,0 +1,{line_count} @@\n"
    );
    for line in text.lines() {
        result.push('+');
        result.push_str(line);
        result.push('\n');
        if result.len() >= MAX_DIFF_BYTES {
            break;
        }
    }
    Ok(result)
}

fn language_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "json" => "json",
        "md" | "mdx" => "markdown",
        "css" | "scss" | "sass" => "css",
        "html" | "htm" => "html",
        "py" => "python",
        "sh" | "zsh" | "bash" => "shell",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "sql" => "sql",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cc" | "cpp" | "hpp" => "cpp",
        _ => "text",
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
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
    use crate::{
        agent::protocol::TaskRuntimeProfile,
        git::repository::git_stdout,
        storage::{
            app_paths::AppPaths,
            database::Database,
            task_repository::TaskRepository,
            tasks::{TaskDraft, TaskIsolation},
        },
    };
    use uuid::Uuid;

    fn fixture() -> (AppPaths, String, PathBuf) {
        let root = std::env::temp_dir().join(format!("pi-workspace-test-{}", Uuid::new_v4()));
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
            tasks_file: root.join("data/tasks.json"),
            root: root.join("data"),
        };
        Database::initialize(&paths).unwrap();
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        git_stdout(&project, &["init"]).unwrap();
        git_stdout(
            &project,
            &["config", "user.email", "pi-desktop@example.invalid"],
        )
        .unwrap();
        git_stdout(&project, &["config", "user.name", "Pi Desktop Test"]).unwrap();
        fs::write(project.join("tracked.txt"), "before\n").unwrap();
        git_stdout(&project, &["add", "tracked.txt"]).unwrap();
        git_stdout(&project, &["commit", "-m", "initial"]).unwrap();
        let task = TaskRepository::save(
            &paths.database_file,
            TaskDraft {
                id: None,
                title: Some("Workspace".into()),
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
        (paths, task.id, project)
    }

    #[test]
    fn snapshots_changes_and_reads_bounded_files() {
        let (paths, task_id, project) = fixture();
        fs::write(project.join("tracked.txt"), "after\n").unwrap();
        fs::write(project.join("new.txt"), "new\n").unwrap();
        fs::create_dir_all(project.join("node_modules/hidden")).unwrap();
        fs::write(project.join("node_modules/hidden/file.js"), "ignored").unwrap();

        let view = snapshot(&paths.database_file, &task_id).unwrap();
        assert!(view.is_git);
        assert_eq!(view.changes.len(), 2);
        assert!(view.files.iter().any(|file| file.path == "tracked.txt"));
        assert!(!view
            .files
            .iter()
            .any(|file| file.path.contains("node_modules")));

        let content = read_file(&paths.database_file, &task_id, "tracked.txt").unwrap();
        assert_eq!(content.content, "after\n");
        assert!(read_file(&paths.database_file, &task_id, "../outside").is_err());

        let patch = diff(&paths.database_file, &task_id, Some("new.txt")).unwrap();
        assert!(patch.content.contains("new file mode"));
        fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let (paths, task_id, project) = fixture();
        let outside = project.parent().unwrap().join("secret.txt");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, project.join("escape.txt")).unwrap();
        assert!(read_file(&paths.database_file, &task_id, "escape.txt").is_err());
        fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }
}
