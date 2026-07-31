use super::protocol::command_envelope;
use crate::{
    broker::service::BrokerService,
    storage::{
        app_paths::AppPaths,
        event_store::{AppendOutcome, EventStore},
    },
    updates,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

#[cfg(not(debug_assertions))]
use tauri::Manager;

pub const HOST_MESSAGE_EVENT: &str = "agent-host-message";
pub const HOST_LIFECYCLE_EVENT: &str = "agent-host-lifecycle";
pub const HOST_LOG_EVENT: &str = "agent-host-log";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHostLaunch {
    pub pid: u32,
    pub runtime: String,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentHostLifecycle {
    status: String,
    pid: u32,
    code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentHostLog {
    stream: String,
    line: String,
}

#[derive(Debug)]
struct ManagedHost {
    pid: u32,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Debug, Default)]
pub struct AgentSupervisor {
    process: Arc<Mutex<Option<ManagedHost>>>,
}

impl AgentSupervisor {
    pub fn start(
        &self,
        app: &AppHandle,
        app_data_dir: &str,
        event_store_path: &Path,
        broker: BrokerService,
        paths: AppPaths,
    ) -> Result<AgentHostLaunch, String> {
        {
            let mut process = self.lock_process()?;
            if let Some(managed) = process.as_mut() {
                let running = managed
                    .child
                    .lock()
                    .map_err(|_| "Pi Host child lock is poisoned".to_string())?
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_none();

                if running {
                    return Ok(AgentHostLaunch {
                        pid: managed.pid,
                        runtime: "existing".into(),
                        entry: "already-running".into(),
                    });
                }

                *process = None;
            }
        }

        let launch = resolve_launch(app, &paths)?;
        if !launch.entry.exists() {
            return Err(format!(
                "Pi Host entry does not exist: {}. Run `npm run build` in packages/pi-agent-host.",
                launch.entry.display()
            ));
        }
        EventStore::open(event_store_path)
            .map_err(|error| format!("task Event Store is unavailable: {error}"))?;

        let mut command = Command::new(&launch.executable);
        command
            .arg(&launch.entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start Pi Host: {error}"))?;
        let pid = child.id();
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Pi Host stdin was not captured".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Pi Host stdout was not captured".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Pi Host stderr was not captured".to_string())?;
        let child = Arc::new(Mutex::new(child));

        let stdin = Arc::new(Mutex::new(stdin));
        *self.lock_process()? = Some(ManagedHost {
            pid,
            child: Arc::clone(&child),
            stdin: Arc::clone(&stdin),
        });

        forward_stdout(
            app.clone(),
            stdout,
            event_store_path.to_path_buf(),
            stdin,
            broker.clone(),
            paths.clone(),
        );
        forward_stderr(app.clone(), stderr);
        monitor_child(app.clone(), pid, child, Arc::clone(&self.process), broker);

        self.send(command_envelope(
            "host.bootstrap",
            json!({ "appDataDir": app_data_dir }),
        )?)?;
        if let Some(version) = launch.managed_version.as_deref() {
            updates::mark_started(&paths, version)?;
        }

        app.emit(
            HOST_LIFECYCLE_EVENT,
            AgentHostLifecycle {
                status: "spawned".into(),
                pid,
                code: None,
            },
        )
        .map_err(|error| error.to_string())?;

        Ok(AgentHostLaunch {
            pid,
            runtime: launch.runtime,
            entry: launch.entry.display().to_string(),
        })
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        if self.try_send(message)? {
            Ok(())
        } else {
            Err("Pi Host is not running".into())
        }
    }

    pub fn try_send(&self, message: Value) -> Result<bool, String> {
        let encoded =
            serde_json::to_string(&message).map_err(|error| format!("invalid message: {error}"))?;
        let process = self.lock_process()?;
        let Some(managed) = process.as_ref() else {
            return Ok(false);
        };
        let mut stdin = managed
            .stdin
            .lock()
            .map_err(|_| "Pi Host stdin lock is poisoned".to_string())?;
        stdin
            .write_all(encoded.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("failed to send message to Pi Host: {error}"))?;
        Ok(true)
    }

    pub fn stop(&self) -> Result<(), String> {
        let managed = self.lock_process()?.take();
        if let Some(managed) = managed {
            let mut child = managed
                .child
                .lock()
                .map_err(|_| "Pi Host child lock is poisoned".to_string())?;
            if child
                .try_wait()
                .map_err(|error| format!("failed to inspect Pi Host: {error}"))?
                .is_some()
            {
                return Ok(());
            }

            let signal_result = unsafe { libc::kill(managed.pid as i32, libc::SIGTERM) };
            if signal_result != 0 {
                return Err(format!(
                    "failed to terminate Pi Host: {}",
                    std::io::Error::last_os_error()
                ));
            }

            for _ in 0..20 {
                thread::sleep(Duration::from_millis(50));
                if child
                    .try_wait()
                    .map_err(|error| format!("failed to inspect Pi Host: {error}"))?
                    .is_some()
                {
                    return Ok(());
                }
            }

            child
                .kill()
                .map_err(|error| format!("failed to force-stop Pi Host: {error}"))?;
        }
        Ok(())
    }

    fn lock_process(&self) -> Result<std::sync::MutexGuard<'_, Option<ManagedHost>>, String> {
        self.process
            .lock()
            .map_err(|_| "Pi Host supervisor lock is poisoned".to_string())
    }
}

#[derive(Debug)]
struct LaunchSpec {
    executable: PathBuf,
    entry: PathBuf,
    runtime: String,
    managed_version: Option<String>,
}

#[cfg(debug_assertions)]
fn resolve_launch(app: &AppHandle, paths: &AppPaths) -> Result<LaunchSpec, String> {
    let executable = std::env::var_os("PI_DESKTOP_NODE_BINARY")
        .map_or_else(|| PathBuf::from("node"), PathBuf::from);
    if let Some(entry) = std::env::var_os("PI_DESKTOP_HOST_ENTRY") {
        return Ok(LaunchSpec {
            executable,
            entry: PathBuf::from(entry),
            runtime: "development-node-override".into(),
            managed_version: None,
        });
    }
    if let Some((host_root, version)) = updates::active_runtime(app, paths) {
        return Ok(LaunchSpec {
            executable,
            entry: host_root.join("dist/main.js"),
            runtime: format!("managed-pi-agent-{version}"),
            managed_version: Some(version),
        });
    }

    Ok(LaunchSpec {
        executable,
        entry: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/pi-agent-host/dist/main.js"),
        runtime: "development-node".into(),
        managed_version: None,
    })
}

#[cfg(not(debug_assertions))]
fn resolve_launch(app: &AppHandle, paths: &AppPaths) -> Result<LaunchSpec, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let executable = resources.join("runtime/node/bin/node");
    if let Some((host_root, version)) = updates::active_runtime(app, paths) {
        return Ok(LaunchSpec {
            executable,
            entry: host_root.join("dist/main.js"),
            runtime: format!("managed-pi-agent-{version}"),
            managed_version: Some(version),
        });
    }
    Ok(LaunchSpec {
        executable,
        entry: resources.join("runtime/pi-agent-host/dist/main.js"),
        runtime: "bundled-node".into(),
        managed_version: None,
    })
}

fn forward_stdout(
    app: AppHandle,
    stdout: impl std::io::Read + Send + 'static,
    event_store_path: PathBuf,
    stdin: Arc<Mutex<ChildStdin>>,
    broker: BrokerService,
    paths: AppPaths,
) {
    thread::spawn(move || {
        let mut event_store = match EventStore::open(&event_store_path) {
            Ok(store) => store,
            Err(error) => {
                let _ = app.emit(
                    HOST_LOG_EVENT,
                    AgentHostLog {
                        stream: "supervisor".into(),
                        line: format!("Event Store could not be opened: {error}"),
                    },
                );
                return;
            }
        };
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        #[cfg(debug_assertions)]
                        eprintln!(
                            "[pi-host] type={} status={}",
                            message
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown"),
                            message
                                .pointer("/state/status")
                                .and_then(Value::as_str)
                                .unwrap_or("-")
                        );
                        if message.get("type").and_then(Value::as_str)
                            == Some("task.broker.request")
                        {
                            let response = match broker.execute_request(&message, &paths) {
                                Ok(execution) => command_envelope(
                                    "broker.response",
                                    json!({
                                        "taskId": execution.task_id,
                                        "requestId": execution.request_id,
                                        "ok": true,
                                        "result": execution.result
                                    }),
                                ),
                                Err(error) => {
                                    let task_id = message
                                        .pointer("/request/taskId")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default();
                                    let request_id = message
                                        .pointer("/request/id")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default();
                                    command_envelope(
                                        "broker.response",
                                        json!({
                                            "taskId": task_id,
                                            "requestId": request_id,
                                            "ok": false,
                                            "error": {
                                                "code": "CAPABILITY_REJECTED",
                                                "message": error
                                            }
                                        }),
                                    )
                                }
                            };
                            match response.and_then(|response| write_host_command(&stdin, response))
                            {
                                Ok(()) => {}
                                Err(error) => {
                                    let _ = app.emit(
                                        HOST_LOG_EVENT,
                                        AgentHostLog {
                                            stream: "supervisor".into(),
                                            line: format!(
                                                "Capability Broker response failed: {error}"
                                            ),
                                        },
                                    );
                                }
                            }
                            continue;
                        }
                        if message.get("type").and_then(Value::as_str)
                            == Some("task.permission.request")
                        {
                            if let Err(error) = broker.register_permission_request(&message) {
                                let _ = app.emit(
                                    HOST_LOG_EVENT,
                                    AgentHostLog {
                                        stream: "supervisor".into(),
                                        line: format!(
                                            "Permission request was rejected by Core: {error}"
                                        ),
                                    },
                                );
                                continue;
                            }
                        }
                        if message.get("type").and_then(Value::as_str) == Some("task.status")
                            && matches!(
                                message.pointer("/task/status").and_then(Value::as_str),
                                Some("failed" | "completed")
                            )
                        {
                            if let Some(task_id) =
                                message.pointer("/task/id").and_then(Value::as_str)
                            {
                                if let Err(error) = broker.revoke_task(task_id) {
                                    let _ = app.emit(
                                        HOST_LOG_EVENT,
                                        AgentHostLog {
                                            stream: "supervisor".into(),
                                            line: format!(
                                                "Task capability revocation failed: {error}"
                                            ),
                                        },
                                    );
                                }
                            }
                        }
                        match event_store.append_message(&message) {
                            Ok(AppendOutcome::Stored(_) | AppendOutcome::NotTaskScoped) => {
                                let _ = app.emit(HOST_MESSAGE_EVENT, message);
                            }
                            Ok(AppendOutcome::Duplicate(_)) => {
                                #[cfg(debug_assertions)]
                                eprintln!("[pi-host] suppressed duplicate persisted event");
                            }
                            Err(error) => {
                                let _ = app.emit(
                                    HOST_LOG_EVENT,
                                    AgentHostLog {
                                        stream: "supervisor".into(),
                                        line: format!(
                                            "Task event was not broadcast because persistence failed: {error}"
                                        ),
                                    },
                                );
                            }
                        }
                    }
                    Err(_) => {
                        let _ = app.emit(
                            HOST_LOG_EVENT,
                            AgentHostLog {
                                stream: "stdout".into(),
                                line,
                            },
                        );
                    }
                },
                Err(error) => {
                    let _ = app.emit(
                        HOST_LOG_EVENT,
                        AgentHostLog {
                            stream: "stdout".into(),
                            line: error.to_string(),
                        },
                    );
                    break;
                }
            }
        }
    });
}

fn write_host_command(stdin: &Arc<Mutex<ChildStdin>>, message: Value) -> Result<(), String> {
    let encoded = serde_json::to_string(&message)
        .map_err(|error| format!("serialize Host command: {error}"))?;
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Pi Host stdin lock is poisoned".to_string())?;
    stdin
        .write_all(encoded.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("send Capability Broker response: {error}"))
}

fn forward_stderr(app: AppHandle, stderr: impl std::io::Read + Send + 'static) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app.emit(
                HOST_LOG_EVENT,
                AgentHostLog {
                    stream: "stderr".into(),
                    line,
                },
            );
        }
    });
}

fn monitor_child(
    app: AppHandle,
    pid: u32,
    child: Arc<Mutex<Child>>,
    process: Arc<Mutex<Option<ManagedHost>>>,
    broker: BrokerService,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        let status = match child.lock() {
            Ok(mut child) => child.try_wait(),
            Err(_) => return,
        };

        match status {
            Ok(Some(status)) => {
                let _ = broker.revoke_all();
                if let Ok(mut current) = process.lock() {
                    if current.as_ref().is_some_and(|managed| managed.pid == pid) {
                        *current = None;
                    }
                }
                let _ = app.emit(
                    HOST_LIFECYCLE_EVENT,
                    AgentHostLifecycle {
                        status: "exited".into(),
                        pid,
                        code: status.code(),
                    },
                );
                return;
            }
            Ok(None) => {}
            Err(error) => {
                let _ = app.emit(
                    HOST_LOG_EVENT,
                    AgentHostLog {
                        stream: "supervisor".into(),
                        line: error.to_string(),
                    },
                );
                return;
            }
        }
    });
}
