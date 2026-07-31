use super::{
    capability::CapabilityTokenStore,
    files::{FileAccess, FileBroker},
};
use crate::{
    policy::engine::{
        CapabilityAction, CapabilityRequest, CapabilityScope, PermissionMode, PolicyDecision,
        PolicyEngine,
    },
    storage::{
        app_paths::AppPaths,
        database::Database,
        extensions::ExtensionStore,
        task_repository::TaskRepository,
        tasks::{TaskIsolation, TaskRecord},
    },
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use globset::{Glob, GlobSetBuilder};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use walkdir::{DirEntry, WalkDir};

const APPROVAL_TTL_MILLIS: u64 = 60_000;
const APPROVAL_MAX_OPERATIONS: u16 = 32;
const MAX_PROCESS_OUTPUT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct BrokerService {
    inner: Arc<BrokerServiceInner>,
}

#[derive(Debug)]
struct BrokerServiceInner {
    policy: PolicyEngine,
    tokens: CapabilityTokenStore,
    approvals: Mutex<HashMap<String, PendingApproval>>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    task_id: String,
    tool_name: String,
    input_hash: String,
    approved: Option<bool>,
    expires_at: u64,
    uses_remaining: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrokerExecution {
    pub task_id: String,
    pub request_id: String,
    pub result: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrokerRequest {
    id: String,
    task_id: String,
    tool_name: String,
    tool_input: Value,
    approval_id: Option<String>,
    operation: String,
    arguments: Value,
}

impl Default for BrokerService {
    fn default() -> Self {
        Self {
            inner: Arc::new(BrokerServiceInner {
                policy: PolicyEngine::default(),
                tokens: CapabilityTokenStore::default(),
                approvals: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl BrokerService {
    pub fn register_permission_request(&self, message: &Value) -> Result<(), String> {
        let request = message
            .get("request")
            .ok_or_else(|| "Permission event has no request".to_string())?;
        let id = required_string(request, "id")?;
        let task_id = required_string(request, "taskId")?;
        let tool_name = required_string(request, "toolName")?;
        let input = request
            .get("input")
            .cloned()
            .ok_or_else(|| "Permission request has no tool input".to_string())?;
        let now = unix_millis()?;
        self.inner
            .approvals
            .lock()
            .map_err(|_| "Broker approval lock is poisoned".to_string())?
            .insert(
                id,
                PendingApproval {
                    task_id,
                    tool_name,
                    input_hash: value_hash(&input)?,
                    approved: None,
                    expires_at: now.saturating_add(APPROVAL_TTL_MILLIS),
                    uses_remaining: APPROVAL_MAX_OPERATIONS,
                },
            );
        Ok(())
    }

    pub fn resolve_permission(
        &self,
        task_id: &str,
        request_id: &str,
        approved: bool,
    ) -> Result<(), String> {
        let mut approvals = self
            .inner
            .approvals
            .lock()
            .map_err(|_| "Broker approval lock is poisoned".to_string())?;
        let approval = approvals.get_mut(request_id).ok_or_else(|| {
            "Permission request is unknown, expired, or already resolved".to_string()
        })?;
        if approval.task_id != task_id {
            return Err("Permission response does not belong to this task".into());
        }
        if unix_millis()? >= approval.expires_at {
            approvals.remove(request_id);
            return Err("Permission request has expired".into());
        }
        approval.approved = Some(approved);
        if !approved {
            approval.uses_remaining = 0;
        }
        Ok(())
    }

    pub fn execute_request(
        &self,
        message: &Value,
        paths: &AppPaths,
    ) -> Result<BrokerExecution, String> {
        let request_value = message
            .get("request")
            .cloned()
            .ok_or_else(|| "Broker event has no request".to_string())?;
        let request: BrokerRequest = serde_json::from_value(request_value)
            .map_err(|error| format!("Invalid Broker request: {error}"))?;
        validate_broker_request(&request)?;
        let task = TaskRepository::get(&paths.database_file, &request.task_id)?
            .ok_or_else(|| format!("Unknown Broker task: {}", request.task_id))?;
        if task.archived {
            return Err("Archived tasks cannot execute capabilities".into());
        }

        let capability = capability_request(&request, &task)?;
        let permission_mode = permission_mode(&task)?;
        let decision = self.inner.policy.evaluate(&capability, permission_mode);
        let authorization = match self.authorize(&request, &decision) {
            Ok(authorization) => authorization,
            Err(error) => {
                append_audit(
                    paths,
                    &request,
                    &decision,
                    request.approval_id.as_deref(),
                    "denied",
                    json!({ "error": error }),
                )?;
                return Err(error);
            }
        };
        let token = self.inner.tokens.issue(&capability, 30_000)?;
        self.inner.tokens.consume(&token.id, &capability)?;

        let execution = execute_operation(&request, &task, paths);
        let (result_label, detail) = match &execution {
            Ok(result) => (
                "allowed",
                sanitized_result_detail(&request.operation, result),
            ),
            Err(error) => ("failed", json!({ "error": error })),
        };
        append_audit(
            paths,
            &request,
            &decision,
            authorization.as_deref(),
            result_label,
            detail,
        )?;
        let result = execution?;
        Ok(BrokerExecution {
            task_id: request.task_id,
            request_id: request.id,
            result,
        })
    }

    pub fn revoke_task(&self, task_id: &str) -> Result<(), String> {
        self.inner.tokens.revoke_task(task_id)?;
        self.inner
            .approvals
            .lock()
            .map_err(|_| "Broker approval lock is poisoned".to_string())?
            .retain(|_, approval| approval.task_id != task_id);
        Ok(())
    }

    pub fn revoke_all(&self) -> Result<(), String> {
        let task_ids: Vec<String> = self
            .inner
            .approvals
            .lock()
            .map_err(|_| "Broker approval lock is poisoned".to_string())?
            .values()
            .map(|approval| approval.task_id.clone())
            .collect();
        for task_id in task_ids {
            self.inner.tokens.revoke_task(&task_id)?;
        }
        self.inner
            .approvals
            .lock()
            .map_err(|_| "Broker approval lock is poisoned".to_string())?
            .clear();
        Ok(())
    }

    fn authorize(
        &self,
        request: &BrokerRequest,
        decision: &PolicyDecision,
    ) -> Result<Option<String>, String> {
        match decision {
            PolicyDecision::Deny { reason } => Err(reason.clone()),
            PolicyDecision::Allow { .. } => {
                if let Some(approval_id) = request.approval_id.as_deref() {
                    self.consume_approval(approval_id, request)?;
                    Ok(Some(approval_id.to_string()))
                } else {
                    Ok(None)
                }
            }
            PolicyDecision::NeedsApproval { reason } => {
                let approval_id = request
                    .approval_id
                    .as_deref()
                    .ok_or_else(|| format!("{reason}; no Core-verified approval was supplied"))?;
                self.consume_approval(approval_id, request)?;
                Ok(Some(approval_id.to_string()))
            }
        }
    }

    fn consume_approval(&self, approval_id: &str, request: &BrokerRequest) -> Result<(), String> {
        let mut approvals = self
            .inner
            .approvals
            .lock()
            .map_err(|_| "Broker approval lock is poisoned".to_string())?;
        let approval = approvals
            .get_mut(approval_id)
            .ok_or_else(|| "Capability approval is unknown or expired".to_string())?;
        if unix_millis()? >= approval.expires_at {
            approvals.remove(approval_id);
            return Err("Capability approval has expired".into());
        }
        if approval.task_id != request.task_id
            || approval.tool_name != request.tool_name
            || approval.input_hash != value_hash(&request.tool_input)?
        {
            return Err("Capability approval does not match this exact tool request".into());
        }
        match approval.approved {
            Some(true) if approval.uses_remaining > 0 => {
                approval.uses_remaining -= 1;
                if approval.uses_remaining == 0 {
                    approvals.remove(approval_id);
                }
                Ok(())
            }
            Some(false) => {
                approvals.remove(approval_id);
                Err("Capability was denied by the user".into())
            }
            None => Err("Capability has not been approved by the user".into()),
            Some(true) => {
                approvals.remove(approval_id);
                Err("Capability approval has no operations remaining".into())
            }
        }
    }
}

fn validate_broker_request(request: &BrokerRequest) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.task_id.trim().is_empty()
        || request.tool_name.trim().is_empty()
        || request.operation.trim().is_empty()
    {
        return Err("Broker request identity fields must be non-empty".into());
    }
    if !request.tool_input.is_object() || !request.arguments.is_object() {
        return Err("Broker request input and arguments must be objects".into());
    }
    Ok(())
}

fn capability_request(
    request: &BrokerRequest,
    task: &TaskRecord,
) -> Result<CapabilityRequest, String> {
    let action = match request.operation.as_str() {
        "fs.read" | "fs.access" | "fs.stat" | "fs.readdir" | "search.grep" | "search.find" => {
            CapabilityAction::FsRead
        }
        "fs.write" | "fs.mkdir" => CapabilityAction::FsWrite,
        "process.shell" => CapabilityAction::ProcessExec,
        "extension.invoke" => CapabilityAction::ExtensionInvoke,
        other => return Err(format!("Unsupported Broker operation: {other}")),
    };
    let scope = if request.operation == "extension.invoke" {
        CapabilityScope::AppData
    } else {
        match task.isolation {
            TaskIsolation::Worktree => CapabilityScope::Worktree,
            TaskIsolation::CurrentCheckout | TaskIsolation::ReadOnly => CapabilityScope::Project,
        }
    };
    let target = request
        .arguments
        .get("path")
        .or_else(|| request.arguments.get("cwd"))
        .or_else(|| request.arguments.get("extensionId"))
        .and_then(Value::as_str)
        .unwrap_or(&task.cwd)
        .to_string();
    Ok(CapabilityRequest {
        task_id: request.task_id.clone(),
        request_id: request.id.clone(),
        action,
        scope,
        target,
        arguments: request.arguments.clone(),
    })
}

fn permission_mode(task: &TaskRecord) -> Result<PermissionMode, String> {
    match task.profile.permission_mode.as_str() {
        "ask" => Ok(PermissionMode::Ask),
        "acceptEdits" => Ok(PermissionMode::AcceptEdits),
        "plan" => Ok(PermissionMode::Plan),
        "auto" => Ok(PermissionMode::Auto),
        value => Err(format!("Unsupported task permission mode: {value}")),
    }
}

fn execute_operation(
    request: &BrokerRequest,
    task: &TaskRecord,
    paths: &AppPaths,
) -> Result<Value, String> {
    let write = matches!(request.operation.as_str(), "fs.write" | "fs.mkdir");
    let access = if write {
        FileAccess::ReadWrite
    } else {
        FileAccess::ReadOnly
    };
    let file_broker = FileBroker::new(Path::new(&task.cwd), access)?;
    match request.operation.as_str() {
        "fs.read" => {
            let relative = broker_relative_path(&file_broker, argument_string(request, "path")?)?;
            let maximum_bytes = request
                .arguments
                .get("maximumBytes")
                .and_then(Value::as_u64)
                .unwrap_or(16 * 1024 * 1024);
            let content = file_broker.read(&relative, maximum_bytes)?;
            Ok(json!({ "dataBase64": BASE64.encode(content) }))
        }
        "fs.access" => {
            let relative = broker_relative_path(&file_broker, argument_string(request, "path")?)?;
            let write = request
                .arguments
                .get("write")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let broker = if write {
                FileBroker::new(Path::new(&task.cwd), FileAccess::ReadWrite)?
            } else {
                file_broker
            };
            broker.access(&relative, write)?;
            Ok(json!({ "accessible": true }))
        }
        "fs.stat" => {
            let relative = broker_relative_path(&file_broker, argument_string(request, "path")?)?;
            let stat = file_broker.stat(&relative)?;
            Ok(json!({
                "exists": stat.exists,
                "isDirectory": stat.is_directory
            }))
        }
        "fs.readdir" => {
            let relative = broker_relative_path(&file_broker, argument_string(request, "path")?)?;
            Ok(json!({ "entries": file_broker.readdir(&relative)? }))
        }
        "fs.write" => {
            let relative = broker_relative_path(&file_broker, argument_string(request, "path")?)?;
            let encoded = argument_string(request, "contentBase64")?;
            let content = BASE64
                .decode(encoded)
                .map_err(|error| format!("Invalid Broker write content: {error}"))?;
            let path = file_broker.write_atomic(&relative, &content)?;
            Ok(json!({
                "path": path.display().to_string(),
                "bytesWritten": content.len()
            }))
        }
        "fs.mkdir" => {
            let relative = broker_relative_path(&file_broker, argument_string(request, "path")?)?;
            let path = file_broker.create_dir_all(&relative)?;
            Ok(json!({ "path": path.display().to_string() }))
        }
        "search.grep" => execute_grep(&file_broker, request),
        "search.find" => execute_find(&file_broker, request),
        "process.shell" => execute_shell(request, task, paths),
        "extension.invoke" => authorize_extension_snapshot(request, paths),
        other => Err(format!("Unsupported Broker operation: {other}")),
    }
}

fn authorize_extension_snapshot(
    request: &BrokerRequest,
    paths: &AppPaths,
) -> Result<Value, String> {
    let extension_id = argument_string(request, "extensionId")?;
    let content_hash = argument_string(request, "contentHash")?;
    let tool_name = argument_string(request, "toolName")?;
    if tool_name.len() > 256 {
        return Err("Managed Extension tool name is too long".into());
    }
    let config = ExtensionStore::runtime_configs(&paths.extensions_file)?
        .into_iter()
        .find(|config| config.id == extension_id)
        .ok_or_else(|| format!("Managed Extension is disabled or unknown: {extension_id}"))?;
    if config.content_hash != content_hash {
        return Err("Managed Extension snapshot changed after task startup".into());
    }
    Ok(json!({
        "authorized": true,
        "extensionId": extension_id,
        "contentHash": content_hash
    }))
}

fn execute_grep(file_broker: &FileBroker, request: &BrokerRequest) -> Result<Value, String> {
    let pattern = argument_string(request, "pattern")?;
    if pattern.len() > 16_384 {
        return Err("Grep pattern is too large".into());
    }
    let search_path = request
        .arguments
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let relative = broker_relative_path(file_broker, search_path)?;
    let canonical_search = file_broker.resolve_existing(&relative)?;
    let limit = request
        .arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .clamp(1, 500);
    let context = request
        .arguments
        .get("context")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(10);
    let mut command = Command::new("rg");
    command
        .arg("--line-number")
        .arg("--color=never")
        .arg("--hidden")
        .arg("--no-heading")
        .arg("--max-filesize")
        .arg("4M")
        .arg("--context")
        .arg(context.to_string());
    if request
        .arguments
        .get("ignoreCase")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        command.arg("--ignore-case");
    }
    if request
        .arguments
        .get("literal")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        command.arg("--fixed-strings");
    }
    if let Some(glob) = request.arguments.get("glob").and_then(Value::as_str) {
        if glob.len() > 1_024 {
            return Err("Grep glob is too large".into());
        }
        command.arg("--glob").arg(glob);
    }
    command
        .arg("--")
        .arg(pattern)
        .arg(canonical_search)
        .current_dir(file_broker.resolve_existing(".")?);
    let output = run_bounded(command, Duration::from_secs(30), MAX_PROCESS_OUTPUT_BYTES)?;
    if output.timed_out {
        return Err("Grep timed out".into());
    }
    if !matches!(output.exit_code, Some(0 | 1)) {
        return Err(format!(
            "Grep failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = text.lines().take(limit as usize).collect();
    let result = if lines.is_empty() {
        "No matches found".to_string()
    } else {
        let mut result = lines.join("\n");
        if text.lines().count() > lines.len() {
            result.push_str(&format!("\n\n[Truncated at {limit} matches]"));
        }
        result
    };
    Ok(json!({ "output": result }))
}

fn execute_find(file_broker: &FileBroker, request: &BrokerRequest) -> Result<Value, String> {
    let pattern = argument_string(request, "pattern")?;
    if pattern.len() > 1_024 {
        return Err("Find pattern is too large".into());
    }
    let search_path = request
        .arguments
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let relative = broker_relative_path(file_broker, search_path)?;
    let search_root = file_broker.resolve_existing(&relative)?;
    if !search_root.is_dir() {
        return Err("Find search root must be a directory".into());
    }
    let limit = request
        .arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(1_000)
        .clamp(1, 2_000) as usize;
    let mut builder = GlobSetBuilder::new();
    builder.add(Glob::new(pattern).map_err(|error| format!("Invalid find glob: {error}"))?);
    let matcher = builder
        .build()
        .map_err(|error| format!("Build find glob: {error}"))?;
    let mut matches = Vec::new();
    for entry in WalkDir::new(&search_root)
        .follow_links(false)
        .max_depth(64)
        .into_iter()
        .filter_entry(include_find_entry)
    {
        let entry = entry.map_err(|error| format!("Walk find path: {error}"))?;
        if entry.path() == search_root {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&search_root)
            .map_err(|error| error.to_string())?;
        if matcher.is_match(relative) {
            matches.push(relative.to_string_lossy().replace('\\', "/"));
            if matches.len() >= limit {
                break;
            }
        }
    }
    let output = if matches.is_empty() {
        "No files found matching pattern".to_string()
    } else {
        let mut output = matches.join("\n");
        if matches.len() == limit {
            output.push_str(&format!("\n\n[Truncated at {limit} results]"));
        }
        output
    };
    Ok(json!({ "output": output }))
}

fn include_find_entry(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    name != ".git" && name != "node_modules"
}

fn execute_shell(
    request: &BrokerRequest,
    task: &TaskRecord,
    paths: &AppPaths,
) -> Result<Value, String> {
    let command_text = argument_string(request, "command")?;
    if command_text.len() > 32 * 1024 {
        return Err("Shell command exceeds the 32 KiB limit".into());
    }
    let requested_cwd = argument_string(request, "cwd")?;
    let cwd = Path::new(&task.cwd)
        .canonicalize()
        .map_err(|error| format!("Resolve task cwd: {error}"))?;
    let requested = Path::new(requested_cwd)
        .canonicalize()
        .map_err(|error| format!("Resolve requested command cwd: {error}"))?;
    if requested != cwd {
        return Err("Shell commands are pinned to the task workspace root".into());
    }
    let timeout = request
        .arguments
        .get("timeoutSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(30)
        .clamp(1, 120);
    let runtime_home = paths.root.join("runtime-home").join(&task.id);
    fs::create_dir_all(&runtime_home).map_err(|error| error.to_string())?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&runtime_home, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Secure task runtime home: {error}"))?;

    let mut command = Command::new("/bin/zsh");
    command
        .arg("-lc")
        .arg(command_text)
        .current_dir(&cwd)
        .env_clear()
        .env(
            "PATH",
            std::env::var("PATH")
                .unwrap_or_else(|_| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".into()),
        )
        .env("HOME", runtime_home)
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8");
    if let Ok(tmpdir) = std::env::var("TMPDIR") {
        command.env("TMPDIR", tmpdir);
    }
    let output = run_bounded(
        command,
        Duration::from_secs(timeout),
        MAX_PROCESS_OUTPUT_BYTES,
    )?;
    Ok(json!({
        "stdoutBase64": BASE64.encode(output.stdout),
        "stderrBase64": BASE64.encode(output.stderr),
        "exitCode": output.exit_code,
        "timedOut": output.timed_out
    }))
}

struct BoundedOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<i32>,
    timed_out: bool,
}

fn run_bounded(
    mut command: Command,
    timeout: Duration,
    maximum_bytes: u64,
) -> Result<BoundedOutput, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Start brokered process: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Brokered process stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Brokered process stderr was not captured".to_string())?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, maximum_bytes));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, maximum_bytes));
    let started = Instant::now();
    let (status, timed_out) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Inspect brokered process: {error}"))?
        {
            break (status, false);
        }
        if started.elapsed() >= timeout {
            child
                .kill()
                .map_err(|error| format!("Stop timed-out brokered process: {error}"))?;
            let status = child
                .wait()
                .map_err(|error| format!("Reap timed-out brokered process: {error}"))?;
            break (status, true);
        }
        thread::sleep(Duration::from_millis(20));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "Brokered stdout reader panicked".to_string())??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "Brokered stderr reader panicked".to_string())??;
    Ok(BoundedOutput {
        stdout,
        stderr,
        exit_code: status.code(),
        timed_out,
    })
}

fn read_bounded(reader: impl Read, maximum_bytes: u64) -> Result<Vec<u8>, String> {
    let mut content = Vec::new();
    reader
        .take(maximum_bytes + 1)
        .read_to_end(&mut content)
        .map_err(|error| format!("Read brokered process output: {error}"))?;
    if content.len() as u64 > maximum_bytes {
        content.truncate(maximum_bytes as usize);
        content.extend_from_slice(b"\n[Output truncated by Pi Desktop]\n");
    }
    Ok(content)
}

fn broker_relative_path(broker: &FileBroker, requested: &str) -> Result<String, String> {
    let path = Path::new(requested);
    if !path.is_absolute() {
        return Ok(requested.to_string());
    }
    let relative = path
        .strip_prefix(broker.root())
        .map_err(|_| "Requested path is outside the task workspace".to_string())?;
    if relative.as_os_str().is_empty() {
        Ok(".".into())
    } else {
        relative
            .to_str()
            .map(str::to_string)
            .ok_or_else(|| "Requested path is not valid UTF-8".to_string())
    }
}

fn argument_string<'a>(request: &'a BrokerRequest, field: &str) -> Result<&'a str, String> {
    request
        .arguments
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Broker operation {} requires {field}", request.operation))
}

fn append_audit(
    paths: &AppPaths,
    request: &BrokerRequest,
    decision: &PolicyDecision,
    approval_id: Option<&str>,
    result: &str,
    detail: Value,
) -> Result<(), String> {
    let connection = Database::open(paths.database_file.clone())?.connection()?;
    let metadata = json!({
        "requestId": request.id,
        "toolName": request.tool_name,
        "operation": request.operation,
        "target": request
            .arguments
            .get("path")
            .or_else(|| request.arguments.get("cwd"))
            .or_else(|| request.arguments.get("extensionId")),
        "decision": decision,
        "approvalId": approval_id,
        "detail": detail
    });
    connection
        .execute(
            "INSERT INTO audit_log(actor, action, target, result, metadata_json, timestamp)
             VALUES ('pi-worker', ?1, ?2, ?3, ?4, ?5)",
            params![
                request.operation,
                request.task_id,
                result,
                serde_json::to_string(&metadata)
                    .map_err(|error| format!("Serialize Broker audit: {error}"))?,
                unix_millis()? as i64
            ],
        )
        .map_err(|error| format!("Append Broker audit log: {error}"))?;
    Ok(())
}

fn sanitized_result_detail(operation: &str, result: &Value) -> Value {
    match operation {
        "fs.read" => json!({
            "encodedBytes": result
                .get("dataBase64")
                .and_then(Value::as_str)
                .map(str::len)
                .unwrap_or(0)
        }),
        "process.shell" => json!({
            "exitCode": result.get("exitCode"),
            "timedOut": result.get("timedOut"),
            "stdoutEncodedBytes": result
                .get("stdoutBase64")
                .and_then(Value::as_str)
                .map(str::len)
                .unwrap_or(0),
            "stderrEncodedBytes": result
                .get("stderrBase64")
                .and_then(Value::as_str)
                .map(str::len)
                .unwrap_or(0)
        }),
        _ => json!({ "ok": true }),
    }
}

fn required_string(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{field} must be a non-empty string"))
}

fn value_hash(value: &Value) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let encoded =
        serde_json::to_vec(value).map_err(|error| format!("Serialize tool input: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
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
        storage::{extensions::ExtensionDraft, task_repository::TaskRepository, tasks::TaskDraft},
    };
    use serde_json::json;
    use uuid::Uuid;

    fn test_paths() -> AppPaths {
        let root = std::env::temp_dir().join(format!("pi-broker-test-{}", Uuid::new_v4()));
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

    fn task(paths: &AppPaths, mode: &str, isolation: TaskIsolation) -> TaskRecord {
        let project = paths.root.join("project");
        fs::create_dir_all(&project).unwrap();
        TaskRepository::save(
            &paths.database_file,
            TaskDraft {
                id: None,
                title: None,
                cwd: project.display().to_string(),
                project_root: None,
                isolation: Some(isolation),
                worktree: None,
                profile: TaskRuntimeProfile {
                    provider_id: None,
                    model_id: None,
                    permission_mode: mode.into(),
                },
            },
        )
        .unwrap()
    }

    fn broker_message(
        task: &TaskRecord,
        request_id: &str,
        approval_id: Option<&str>,
        operation: &str,
        arguments: Value,
        tool_name: &str,
        tool_input: Value,
    ) -> Value {
        json!({
            "request": {
                "id": request_id,
                "taskId": task.id,
                "toolName": tool_name,
                "toolInput": tool_input,
                "approvalId": approval_id,
                "operation": operation,
                "arguments": arguments
            }
        })
    }

    #[test]
    fn broker_reads_inside_scope_and_rejects_symlink_escape() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let task = task(&paths, "ask", TaskIsolation::CurrentCheckout);
        fs::write(Path::new(&task.cwd).join("README.md"), "hello").unwrap();
        let service = BrokerService::default();
        let result = service
            .execute_request(
                &broker_message(
                    &task,
                    "broker-1",
                    None,
                    "fs.read",
                    json!({ "path": Path::new(&task.cwd).join("README.md"), "maximumBytes": 100 }),
                    "read",
                    json!({ "path": "README.md" }),
                ),
                &paths,
            )
            .unwrap();
        assert_eq!(
            BASE64
                .decode(result.result["dataBase64"].as_str().unwrap())
                .unwrap(),
            b"hello"
        );

        let outside = paths.root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, Path::new(&task.cwd).join("escape")).unwrap();
        assert!(service
            .execute_request(
                &broker_message(
                    &task,
                    "broker-2",
                    None,
                    "fs.read",
                    json!({ "path": Path::new(&task.cwd).join("escape/secret") }),
                    "read",
                    json!({ "path": "escape/secret" }),
                ),
                &paths,
            )
            .is_err());
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn ask_write_requires_core_observed_exact_approval() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let task = task(&paths, "ask", TaskIsolation::CurrentCheckout);
        let service = BrokerService::default();
        let permission_id = "permission-1";
        let input = json!({ "path": "created.txt", "content": "hello" });
        service
            .register_permission_request(&json!({
                "request": {
                    "id": permission_id,
                    "taskId": task.id,
                    "toolName": "write",
                    "input": input
                }
            }))
            .unwrap();
        service
            .resolve_permission(&task.id, permission_id, true)
            .unwrap();
        let message = broker_message(
            &task,
            "broker-write",
            Some(permission_id),
            "fs.write",
            json!({
                "path": Path::new(&task.cwd).join("created.txt"),
                "contentBase64": BASE64.encode("hello")
            }),
            "write",
            input,
        );
        service.execute_request(&message, &paths).unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&task.cwd).join("created.txt")).unwrap(),
            "hello"
        );

        let forged = broker_message(
            &task,
            "broker-forged",
            Some(permission_id),
            "fs.write",
            json!({
                "path": Path::new(&task.cwd).join("other.txt"),
                "contentBase64": BASE64.encode("bad")
            }),
            "write",
            json!({ "path": "other.txt", "content": "bad" }),
        );
        assert!(service.execute_request(&forged, &paths).is_err());
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn plan_write_and_unapproved_shell_fail_closed() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let task = task(&paths, "plan", TaskIsolation::CurrentCheckout);
        let service = BrokerService::default();
        assert!(service
            .execute_request(
                &broker_message(
                    &task,
                    "broker-write",
                    None,
                    "fs.write",
                    json!({
                        "path": Path::new(&task.cwd).join("blocked.txt"),
                        "contentBase64": BASE64.encode("blocked")
                    }),
                    "write",
                    json!({ "path": "blocked.txt", "content": "blocked" }),
                ),
                &paths,
            )
            .is_err());
        assert!(!Path::new(&task.cwd).join("blocked.txt").exists());
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn managed_extension_invocation_requires_exact_approved_snapshot() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let task = task(&paths, "ask", TaskIsolation::CurrentCheckout);
        let source = paths.root.join("safe-extension.ts");
        fs::write(
            &source,
            "export default function register(pi) { pi.registerTool({ name: 'echo' }); }",
        )
        .unwrap();
        let extension = ExtensionStore::save(
            &paths.extensions_file,
            &paths.extension_packages,
            ExtensionDraft {
                id: None,
                name: "Safe extension".into(),
                source_path: source.display().to_string(),
                enabled: true,
                approved: false,
                approved_content_hash: None,
            },
        )
        .unwrap();
        let identity = format!("extension:{}:echo", extension.id);
        let input = json!({ "value": "hello" });
        let permission_id = "extension-permission";
        let service = BrokerService::default();
        service
            .register_permission_request(&json!({
                "request": {
                    "id": permission_id,
                    "taskId": task.id,
                    "toolName": identity,
                    "input": input
                }
            }))
            .unwrap();
        service
            .resolve_permission(&task.id, permission_id, true)
            .unwrap();
        let authorized = broker_message(
            &task,
            "extension-broker",
            Some(permission_id),
            "extension.invoke",
            json!({
                "extensionId": extension.id,
                "contentHash": extension.content_hash,
                "toolName": "echo"
            }),
            &identity,
            input,
        );
        assert_eq!(
            service.execute_request(&authorized, &paths).unwrap().result["authorized"],
            true
        );

        let stale = broker_message(
            &task,
            "extension-stale",
            None,
            "extension.invoke",
            json!({
                "extensionId": extension.id,
                "contentHash": "stale",
                "toolName": "echo"
            }),
            &identity,
            json!({ "value": "hello" }),
        );
        assert!(service.execute_request(&stale, &paths).is_err());
        fs::remove_dir_all(paths.root).unwrap();
    }
}
