use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub root: String,
    pub baseline: String,
    pub current_branch: Option<String>,
}

pub fn inspect_repository(path: &Path) -> Result<RepositoryInfo, String> {
    let requested = path
        .canonicalize()
        .map_err(|error| format!("Cannot open project folder {}: {error}", path.display()))?;
    if !requested.is_dir() {
        return Err(format!(
            "Project folder is not a directory: {}",
            requested.display()
        ));
    }
    let root = PathBuf::from(git_stdout(&requested, &["rev-parse", "--show-toplevel"])?);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Git repository root: {error}"))?;
    let baseline = git_stdout(&root, &["rev-parse", "--verify", "HEAD^{commit}"])?;
    let current_branch = match run_git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])? {
        output if output.status.success() => {
            let branch = output_text(&output.stdout);
            (!branch.is_empty()).then_some(branch)
        }
        _ => None,
    };
    Ok(RepositoryInfo {
        root: root.display().to_string(),
        baseline,
        current_branch,
    })
}

pub(crate) fn git_stdout(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = run_git(cwd, args)?;
    if !output.status.success() {
        return Err(git_failure(args, &output));
    }
    Ok(output_text(&output.stdout))
}

pub(crate) fn run_git(cwd: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))
}

/// Same as [`run_git`] but feeds `stdin_bytes` to the child (used by `git apply`,
/// which reads the patch from stdin).
pub(crate) fn run_git_stdin(
    cwd: &Path,
    args: &[&str],
    stdin_bytes: &[u8],
) -> Result<Output, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to run git: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open git stdin".to_string())?
        .write_all(stdin_bytes)
        .map_err(|error| format!("Failed to write git stdin: {error}"))?;
    child
        .wait_with_output()
        .map_err(|error| format!("Failed to run git: {error}"))
}

pub(crate) fn git_failure(args: &[&str], output: &Output) -> String {
    let stderr = output_text(&output.stderr);
    let stdout = output_text(&output.stdout);
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    if detail.is_empty() {
        format!(
            "git {} failed with status {}",
            args.join(" "),
            output.status
        )
    } else {
        format!("git {} failed: {detail}", args.join(" "))
    }
}

pub(crate) fn output_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn rejects_non_repository_and_inspects_repository() {
        let root = std::env::temp_dir().join(format!("pi-repository-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        assert!(inspect_repository(&root).is_err());

        git_stdout(&root, &["init"]).unwrap();
        git_stdout(
            &root,
            &["config", "user.email", "pi-desktop@example.invalid"],
        )
        .unwrap();
        git_stdout(&root, &["config", "user.name", "Pi Desktop Test"]).unwrap();
        fs::write(root.join("README.md"), "test\n").unwrap();
        git_stdout(&root, &["add", "README.md"]).unwrap();
        git_stdout(&root, &["commit", "-m", "initial"]).unwrap();

        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let info = inspect_repository(&nested).unwrap();
        assert_eq!(
            Path::new(&info.root),
            root.canonicalize().unwrap().as_path()
        );
        assert_eq!(info.baseline.len(), 40);
        fs::remove_dir_all(root).unwrap();
    }
}
