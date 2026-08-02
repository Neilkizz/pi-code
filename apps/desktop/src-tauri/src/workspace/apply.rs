use super::{git_changes, resolve_existing_file, task_root, validate_relative_path};
use crate::{
    git::repository::{git_failure, run_git, run_git_stdin},
    storage::app_paths::AppPaths,
    storage::database::Database,
};
use rusqlite::params;
use serde::Serialize;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// Result of a user-initiated diff Keep/Revert operation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePatchResult {
    pub ok: bool,
    pub operation: String,
    pub path: String,
    /// Number of hunks applied (0 when the working tree already matched).
    pub applied_hunks: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// One unified-diff hunk with its old/new line ranges and the verbatim body text
/// (the `@@` header line plus all context/added/removed lines), used to rebuild a
/// minimal `git apply` patch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub body: String,
}

/// Parse `git diff` output into its hunks. Each hunk body is copied verbatim so the
/// resulting patch is byte-faithful to what git produced (including `\ No newline`
/// markers), which makes `git apply` context-matching reliable.
pub fn parse_unified_hunks(content: &str) -> Vec<UnifiedHunk> {
    let mut hunks = Vec::new();
    let mut current: Option<UnifiedHunk> = None;
    for line in content.lines() {
        if line.starts_with("@@ -") {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            match parse_hunk_header(line) {
                Some((old_start, old_lines, new_start, new_lines)) => {
                    let mut body = String::new();
                    body.push_str(line);
                    body.push('\n');
                    current = Some(UnifiedHunk {
                        old_start,
                        old_lines,
                        new_start,
                        new_lines,
                        body,
                    });
                }
                None => current = None,
            }
        } else if let Some(hunk) = current.as_mut() {
            hunk.body.push_str(line);
            hunk.body.push('\n');
        }
    }
    if let Some(hunk) = current {
        hunks.push(hunk);
    }
    hunks
}

fn parse_hunk_header(line: &str) -> Option<(usize, usize, usize, usize)> {
    let after = line.strip_prefix("@@ -")?;
    let (old_start, rest) = take_int(after)?;
    let (old_lines, rest) = take_optional_count(rest)?;
    let rest = rest.strip_prefix(" +")?;
    let (new_start, rest) = take_int(rest)?;
    let (new_lines, _) = take_optional_count(rest)?;
    Some((old_start, old_lines, new_start, new_lines))
}

fn take_int(s: &str) -> Option<(usize, &str)> {
    let index = s.find(|c: char| !c.is_ascii_digit())?;
    let value: usize = s[..index].parse().ok()?;
    Some((value, &s[index..]))
}

fn take_optional_count(s: &str) -> Option<(usize, &str)> {
    match s.strip_prefix(',') {
        Some(rest) => {
            let (count, rest) = take_int(rest)?;
            Some((count, rest))
        }
        None => Some((1, s)),
    }
}

/// Apply a single hunk (Keep/Revert) or a whole-file operation for the task workspace.
///
/// `hunk_body` is the verbatim hunk text (the `@@` header line plus its
/// context/added/removed lines) that the frontend parsed from the displayed diff.
/// For a whole-file operation it is `None`. The `old_start`/`old_lines`/
/// `new_start`/`new_lines` ranges must match the body and are used as a tamper
/// guard against a stale or mismatched hunk.
pub fn apply_patch(
    paths: &AppPaths,
    task_id: &str,
    relative_path: &str,
    operation: &str,
    hunk_body: Option<&str>,
    old_start: Option<usize>,
    old_lines: Option<usize>,
    new_start: Option<usize>,
    new_lines: Option<usize>,
) -> Result<WorkspacePatchResult, String> {
    if operation != "keep" && operation != "revert" {
        return Err(format!("Unknown diff operation: {operation}"));
    }
    let root = task_root(&paths.database_file, task_id)?;
    let relative = validate_relative_path(relative_path)?;
    reject_symlink(&root, &relative)?;
    match hunk_body {
        Some(body) => {
            let hunks = parse_unified_hunks(body);
            let hunk = hunks
                .first()
                .ok_or_else(|| "Diff hunk body is invalid".to_string())?;
            if hunks.len() != 1 || !ranges_match(hunk, old_start, old_lines, new_start, new_lines) {
                return Err("Diff hunk reference does not match the requested hunk".into());
            }
            apply_hunk(&root, paths, task_id, &relative, operation, body)
        }
        None => apply_whole_file(&root, paths, task_id, &relative, operation),
    }
}

fn ranges_match(
    hunk: &UnifiedHunk,
    old_start: Option<usize>,
    old_lines: Option<usize>,
    new_start: Option<usize>,
    new_lines: Option<usize>,
) -> bool {
    old_start == Some(hunk.old_start)
        && old_lines == Some(hunk.old_lines)
        && new_start == Some(hunk.new_start)
        && new_lines == Some(hunk.new_lines)
}

fn reject_symlink(root: &Path, relative: &str) -> Result<(), String> {
    match fs::symlink_metadata(root.join(relative)) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("Refusing to review a symlink: {relative}"))
        }
        _ => Ok(()),
    }
}

fn apply_hunk(
    root: &Path,
    paths: &AppPaths,
    task_id: &str,
    relative: &str,
    operation: &str,
    body: &str,
) -> Result<WorkspacePatchResult, String> {
    let status = change_status(root, relative)?;
    match status.as_deref() {
        Some("untracked") => return Err("Untracked files support whole-file actions only".into()),
        Some("deleted") => {
            return Err("This file was deleted; hunk review is unavailable".into());
        }
        Some("conflicted") => return Err("Conflicted files cannot be reviewed as hunks".into()),
        _ => {}
    }
    verify_regular_file(root, relative)?;

    let patch = format!("--- a/{relative}\n+++ b/{relative}\n{body}");
    apply_git_patch(
        root,
        paths,
        task_id,
        relative,
        operation,
        patch.as_bytes(),
        1,
    )
}

fn apply_whole_file(
    root: &Path,
    paths: &AppPaths,
    task_id: &str,
    relative: &str,
    operation: &str,
) -> Result<WorkspacePatchResult, String> {
    let status = change_status(root, relative)?;
    match status.as_deref() {
        Some("untracked") => return apply_untracked(root, paths, task_id, relative, operation),
        Some("deleted") => {
            return Err("This file was deleted; revert is unavailable in this review".into());
        }
        Some("conflicted") => return Err("Conflicted files cannot be reverted here".into()),
        _ => {}
    }
    // A reverted untracked file is no longer listed in `git status`; restore it on Keep.
    if operation == "keep" && backup_path(paths, task_id, relative).exists() {
        return apply_untracked(root, paths, task_id, relative, operation);
    }
    verify_regular_file(root, relative)?;

    if operation == "keep" {
        // Keeping the whole file is a no-op: the working tree already holds the change.
        append_audit(paths, task_id, operation, relative, 0, "kept as-is")?;
        return Ok(WorkspacePatchResult {
            ok: true,
            operation: operation.to_string(),
            path: relative.to_string(),
            applied_hunks: 0,
            message: None,
        });
    }

    let diff_output = diff_tracked(root, relative)?;
    if diff_output.stdout.is_empty() {
        append_audit(
            paths,
            task_id,
            operation,
            relative,
            0,
            "already matches HEAD",
        )?;
        return Ok(WorkspacePatchResult {
            ok: true,
            operation: operation.to_string(),
            path: relative.to_string(),
            applied_hunks: 0,
            message: Some("Working tree already matches HEAD".into()),
        });
    }
    let hunks = parse_unified_hunks(&String::from_utf8_lossy(&diff_output.stdout));
    apply_git_patch(
        root,
        paths,
        task_id,
        relative,
        operation,
        &diff_output.stdout,
        hunks.len(),
    )
}

/// Back up the file bytes under app data before deleting so a later Keep can restore.
fn apply_untracked(
    root: &Path,
    paths: &AppPaths,
    task_id: &str,
    relative: &str,
    operation: &str,
) -> Result<WorkspacePatchResult, String> {
    let file = root.join(relative);
    let backup = backup_path(paths, task_id, relative);
    match operation {
        "revert" => {
            if !file.exists() {
                append_audit(paths, task_id, operation, relative, 0, "already absent")?;
                return Ok(WorkspacePatchResult {
                    ok: true,
                    operation: operation.to_string(),
                    path: relative.to_string(),
                    applied_hunks: 0,
                    message: Some("File is already absent".into()),
                });
            }
            let bytes = fs::read(&file)
                .map_err(|error| format!("Cannot read untracked file {relative}: {error}"))?;
            if let Some(parent) = backup.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Cannot create review backup directory: {error}"))?;
            }
            fs::write(&backup, bytes)
                .map_err(|error| format!("Cannot back up {relative} before revert: {error}"))?;
            fs::remove_file(&file)
                .map_err(|error| format!("Cannot delete untracked file {relative}: {error}"))?;
            append_audit(
                paths,
                task_id,
                operation,
                relative,
                1,
                "backed up and deleted",
            )?;
            Ok(WorkspacePatchResult {
                ok: true,
                operation: operation.to_string(),
                path: relative.to_string(),
                applied_hunks: 1,
                message: None,
            })
        }
        _ => {
            if backup.exists() {
                if let Some(parent) = file.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("Cannot create file directory: {error}"))?;
                }
                fs::copy(&backup, &file).map_err(|error| {
                    format!("Cannot restore untracked file {relative}: {error}")
                })?;
                fs::remove_file(&backup).ok();
            }
            append_audit(paths, task_id, operation, relative, 1, "restored or kept")?;
            Ok(WorkspacePatchResult {
                ok: true,
                operation: operation.to_string(),
                path: relative.to_string(),
                applied_hunks: 1,
                message: None,
            })
        }
    }
}

fn apply_git_patch(
    root: &Path,
    paths: &AppPaths,
    task_id: &str,
    relative: &str,
    operation: &str,
    patch: &[u8],
    applied_hunks: usize,
) -> Result<WorkspacePatchResult, String> {
    let args: Vec<&str> = if operation == "revert" {
        vec!["apply", "--reverse", "--whitespace=nowarn"]
    } else {
        vec!["apply", "--whitespace=nowarn"]
    };
    let output = run_git_stdin(root, &args, patch)?;
    if !output.status.success() {
        let detail = git_failure(&args, &output);
        let _ = append_audit(paths, task_id, operation, relative, applied_hunks, &detail);
        return Err(format!(
            "Diff is stale — refresh to review current changes: {detail}"
        ));
    }
    append_audit(paths, task_id, operation, relative, applied_hunks, "ok")?;
    Ok(WorkspacePatchResult {
        ok: true,
        operation: operation.to_string(),
        path: relative.to_string(),
        applied_hunks,
        message: None,
    })
}

fn diff_tracked(root: &Path, relative: &str) -> Result<std::process::Output, String> {
    let args = [
        "diff",
        "--no-ext-diff",
        "--find-renames",
        "--unified=4",
        "HEAD",
        "--",
        relative,
    ];
    let output = run_git(root, &args)?;
    if !output.status.success() {
        return Err(git_failure(&args, &output));
    }
    Ok(output)
}

fn change_status(root: &Path, relative: &str) -> Result<Option<String>, String> {
    Ok(git_changes(root)?
        .into_iter()
        .find(|change| change.path == relative)
        .map(|change| change.status))
}

pub(super) fn verify_regular_file(root: &Path, relative: &str) -> Result<(), String> {
    let path = root.join(relative);
    // Inspect the un-resolved path so a symlink at `relative` is rejected even when
    // it points inside the task root.
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Cannot inspect {relative}: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Refusing to review a symlink: {relative}"));
    }
    if !metadata.is_file() {
        return Err(format!("Workspace path is not a file: {relative}"));
    }
    // Boundary check: the canonical target must remain inside the task root.
    resolve_existing_file(root, relative)?;
    Ok(())
}

fn backup_path(paths: &AppPaths, task_id: &str, relative: &str) -> PathBuf {
    paths
        .backups
        .join("diff-review")
        .join(task_id)
        .join(relative.replace('/', "__"))
}

fn append_audit(
    paths: &AppPaths,
    task_id: &str,
    operation: &str,
    path: &str,
    applied_hunks: usize,
    detail: &str,
) -> Result<(), String> {
    let connection = Database::open(paths.database_file.clone())?.connection()?;
    let metadata = json!({
        "actor": "user",
        "path": path,
        "operation": operation,
        "appliedHunks": applied_hunks,
        "detail": detail,
    });
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|error| format!("Serialize diff review audit: {error}"))?;
    let action = format!("diff.{operation}");
    connection
        .execute(
            "INSERT INTO audit_log(actor, action, target, result, metadata_json, timestamp)
             VALUES ('user', ?1, ?2, ?3, ?4, ?5)",
            params![action, task_id, "ok", metadata_json, unix_millis()?],
        )
        .map_err(|error| format!("Append diff review audit log: {error}"))?;
    Ok(())
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
        let root = std::env::temp_dir().join(format!("pi-apply-test-{}", Uuid::new_v4()));
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
            resources_file: root.join("resources.json"),
            agent_skills: root.join("agent").join("skills"),
            agent_prompts: root.join("agent").join("prompts"),
            connectors_file: root.join("connectors.json"),
            connector_runtime: root.join("connector-runtime"),
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
        fs::write(project.join("tracked.txt"), file_with(60)).unwrap();
        git_stdout(&project, &["add", "tracked.txt"]).unwrap();
        git_stdout(&project, &["commit", "-m", "initial"]).unwrap();
        let task = TaskRepository::save(
            &paths.database_file,
            TaskDraft {
                id: None,
                title: Some("Apply".into()),
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

    /// `line1\nline2\n...\nlineN\n`
    fn file_with(count: usize) -> String {
        (1..=count)
            .map(|i| format!("line{i}"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n"
    }

    fn diff_text(project: &Path, file: &str) -> String {
        git_stdout(project, &["diff", "HEAD", "--", file]).unwrap()
    }

    fn cleanup(paths: &AppPaths) {
        let _ = fs::remove_dir_all(paths.root.parent().unwrap());
    }

    #[test]
    fn parses_hunk_headers_and_bodies() {
        let content = "\
diff --git a/f.txt b/f.txt
index 0000000..1111111 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 a
-b
+b2
 c
@@ -10 +10,2 @@
 d
+e
";
        let hunks = parse_unified_hunks(content);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 3);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_lines, 3);
        assert!(hunks[0].body.contains("-b\n"));
        assert!(hunks[0].body.contains("+b2\n"));
        assert_eq!(hunks[1].old_start, 10);
        assert_eq!(hunks[1].old_lines, 1);
        assert_eq!(hunks[1].new_start, 10);
        assert_eq!(hunks[1].new_lines, 2);
    }

    #[test]
    fn reverts_one_hunk_and_preserves_others_and_unrelated_changes() {
        let (paths, task_id, project) = fixture();
        let mut lines: Vec<String> = (1..=60).map(|i| format!("line{i}")).collect();
        lines[1] = "LINE2".into();
        lines[24] = "MIDDLE".into();
        lines[39] = "LINE40".into();
        fs::write(project.join("tracked.txt"), lines.join("\n") + "\n").unwrap();
        fs::write(project.join("unrelated.txt"), "untouched\n").unwrap();

        let hunks = parse_unified_hunks(&diff_text(&project, "tracked.txt"));
        assert!(hunks.len() >= 3);
        let middle = hunks
            .iter()
            .find(|h| h.body.contains("MIDDLE"))
            .expect("middle hunk");
        let result = apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "revert",
            Some(middle.body.as_str()),
            Some(middle.old_start),
            Some(middle.old_lines),
            Some(middle.new_start),
            Some(middle.new_lines),
        )
        .unwrap();
        assert!(result.ok);
        assert_eq!(result.applied_hunks, 1);

        let content = fs::read_to_string(project.join("tracked.txt")).unwrap();
        assert!(content.contains("LINE2\n"));
        assert!(!content.contains("MIDDLE"));
        assert!(content.contains("LINE40\n"));
        assert_eq!(
            fs::read_to_string(project.join("unrelated.txt")).unwrap(),
            "untouched\n"
        );
        cleanup(&paths);
    }

    #[test]
    fn keep_after_revert_reapplies_the_hunk() {
        let (paths, task_id, project) = fixture();
        let mut lines: Vec<String> = (1..=60).map(|i| format!("line{i}")).collect();
        lines[24] = "MIDDLE".into();
        fs::write(project.join("tracked.txt"), lines.join("\n") + "\n").unwrap();

        let hunks = parse_unified_hunks(&diff_text(&project, "tracked.txt"));
        let hunk = hunks
            .iter()
            .find(|h| h.body.contains("MIDDLE"))
            .expect("hunk");

        apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "revert",
            Some(hunk.body.as_str()),
            Some(hunk.old_start),
            Some(hunk.old_lines),
            Some(hunk.new_start),
            Some(hunk.new_lines),
        )
        .unwrap();
        assert!(!fs::read_to_string(project.join("tracked.txt"))
            .unwrap()
            .contains("MIDDLE"));

        apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "keep",
            Some(hunk.body.as_str()),
            Some(hunk.old_start),
            Some(hunk.old_lines),
            Some(hunk.new_start),
            Some(hunk.new_lines),
        )
        .unwrap();
        assert!(fs::read_to_string(project.join("tracked.txt"))
            .unwrap()
            .contains("MIDDLE"));
        cleanup(&paths);
    }

    #[test]
    fn revert_whole_file_restores_head() {
        let (paths, task_id, project) = fixture();
        fs::write(project.join("tracked.txt"), "completely different\n").unwrap();
        let result = apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "revert",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(result.ok);
        assert_eq!(
            fs::read_to_string(project.join("tracked.txt")).unwrap(),
            file_with(60)
        );
        assert!(diff_text(&project, "tracked.txt").is_empty());
        cleanup(&paths);
    }

    #[test]
    fn stale_hunk_is_refused_and_file_untouched() {
        let (paths, task_id, project) = fixture();
        let mut lines: Vec<String> = (1..=60).map(|i| format!("line{i}")).collect();
        lines[24] = "MIDDLE".into();
        fs::write(project.join("tracked.txt"), lines.join("\n") + "\n").unwrap();

        let hunks = parse_unified_hunks(&diff_text(&project, "tracked.txt"));
        let hunk = hunks
            .iter()
            .find(|h| h.body.contains("MIDDLE"))
            .expect("hunk");

        // The file changes externally after the diff was computed.
        fs::write(project.join("tracked.txt"), file_with(60)).unwrap();
        let error = apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "revert",
            Some(hunk.body.as_str()),
            Some(hunk.old_start),
            Some(hunk.old_lines),
            Some(hunk.new_start),
            Some(hunk.new_lines),
        )
        .unwrap_err();
        assert!(error.contains("stale"), "{error}");
        assert_eq!(
            fs::read_to_string(project.join("tracked.txt")).unwrap(),
            file_with(60)
        );
        cleanup(&paths);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_paths() {
        use std::os::unix::fs::symlink;
        let (paths, task_id, project) = fixture();
        let outside = project.parent().unwrap().join("secret.txt");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, project.join("escape.txt")).unwrap();
        let error = apply_patch(
            &paths,
            &task_id,
            "escape.txt",
            "revert",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(error.contains("symlink"), "{error}");
        cleanup(&paths);
    }

    #[test]
    fn refuses_path_traversal_and_unknown_operations() {
        let (paths, task_id, _project) = fixture();
        let traversal = apply_patch(
            &paths,
            &task_id,
            "../outside.txt",
            "revert",
            None,
            None,
            None,
            None,
            None,
        );
        assert!(traversal.is_err());
        let operation = apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "explode",
            None,
            None,
            None,
            None,
            None,
        );
        assert!(operation.unwrap_err().contains("Unknown diff operation"));
        cleanup(&paths);
    }

    #[test]
    fn untracked_revert_deletes_and_keep_restores() {
        let (paths, task_id, project) = fixture();
        fs::write(project.join("new.txt"), "hello pi\n").unwrap();

        apply_patch(
            &paths, &task_id, "new.txt", "revert", None, None, None, None, None,
        )
        .unwrap();
        assert!(!project.join("new.txt").exists());

        apply_patch(
            &paths, &task_id, "new.txt", "keep", None, None, None, None, None,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(project.join("new.txt")).unwrap(),
            "hello pi\n"
        );
        cleanup(&paths);
    }

    #[test]
    fn writes_audit_rows_for_user_actions() {
        let (paths, task_id, project) = fixture();
        let mut lines: Vec<String> = (1..=60).map(|i| format!("line{i}")).collect();
        lines[24] = "MIDDLE".into();
        fs::write(project.join("tracked.txt"), lines.join("\n") + "\n").unwrap();
        let hunks = parse_unified_hunks(&diff_text(&project, "tracked.txt"));
        let hunk = hunks
            .iter()
            .find(|h| h.body.contains("MIDDLE"))
            .expect("hunk");
        apply_patch(
            &paths,
            &task_id,
            "tracked.txt",
            "revert",
            Some(hunk.body.as_str()),
            Some(hunk.old_start),
            Some(hunk.old_lines),
            Some(hunk.new_start),
            Some(hunk.new_lines),
        )
        .unwrap();

        let connection = Database::open(paths.database_file.clone())
            .unwrap()
            .connection()
            .unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE actor = 'user' AND action = 'diff.revert' AND target = ?1",
                params![task_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        cleanup(&paths);
    }
}
