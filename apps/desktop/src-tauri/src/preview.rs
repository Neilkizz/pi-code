use crate::{storage::database::Database, workspace};
use rusqlite::params;
use serde::Serialize;
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;
use tiny_http::{Header, Response, Server};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewServerState {
    pub task_id: String,
    pub port: u16,
    pub url: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLogLine {
    pub task_id: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub bytes: u64,
    pub mime: String,
}

struct PreviewServer {
    port: u16,
    root: PathBuf,
    stop: Arc<AtomicBool>,
    unblock: Arc<Server>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl std::fmt::Debug for PreviewServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PreviewServer")
            .field("port", &self.port)
            .field("root", &self.root)
            .field("stopping", &self.stop.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Default)]
pub struct PreviewManager {
    servers: Mutex<HashMap<String, Arc<PreviewServer>>>,
}

impl PreviewManager {
    pub fn start(
        &self,
        app: &tauri::AppHandle,
        database_path: &Path,
        task_id: &str,
    ) -> Result<PreviewServerState, String> {
        let app = app.clone();
        self.start_with_log(
            database_path,
            task_id,
            Arc::new(move |line: &PreviewLogLine| {
                let _ = app.emit("preview-log", line.clone());
            }),
        )
    }

    fn start_with_log(
        &self,
        database_path: &Path,
        task_id: &str,
        log: Arc<dyn Fn(&PreviewLogLine) + Send + Sync>,
    ) -> Result<PreviewServerState, String> {
        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "Preview manager lock is poisoned".to_string())?;
        if let Some(existing) = servers.get(task_id) {
            if !existing.stop.load(Ordering::Acquire) {
                return Ok(state_from(task_id, existing));
            }
            servers.remove(task_id);
        }

        let root = workspace::task_root(database_path, task_id)?;
        let (port, stop, unblock, handle) = spawn_server(root.clone(), task_id, log.clone())?;
        append_preview_audit(database_path, task_id, "preview.server_start", port, &root)?;

        let server = PreviewServer {
            port,
            root,
            stop,
            unblock,
            handle: Mutex::new(Some(handle)),
        };
        let state = state_from(task_id, &server);
        servers.insert(task_id.to_string(), Arc::new(server));
        Ok(state)
    }

    pub fn stop(&self, database_path: &Path, task_id: &str) -> Result<(), String> {
        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "Preview manager lock is poisoned".to_string())?;
        if let Some(server) = servers.remove(task_id) {
            server.stop.store(true, Ordering::Release);
            server.unblock.unblock();
            let handle = server
                .handle
                .lock()
                .map_err(|_| "Preview handle lock is poisoned".to_string())?
                .take();
            if let Some(handle) = handle {
                let _ = handle.join();
            }
            append_preview_audit(
                database_path,
                task_id,
                "preview.server_stop",
                server.port,
                &server.root,
            )?;
        }
        Ok(())
    }

    pub fn status(&self, task_id: &str) -> Option<PreviewServerState> {
        let servers = self.servers.lock().ok()?;
        let server = servers.get(task_id)?;
        if server.stop.load(Ordering::Acquire) {
            return None;
        }
        Some(state_from(task_id, server))
    }

    pub fn stop_all(&self) {
        if let Ok(servers) = self.servers.lock() {
            for server in servers.values() {
                server.stop.store(true, Ordering::Release);
                server.unblock.unblock();
                if let Ok(mut handle) = server.handle.lock() {
                    if let Some(handle) = handle.take() {
                        let _ = handle.join();
                    }
                }
            }
        }
        if let Ok(mut servers) = self.servers.lock() {
            servers.clear();
        }
    }
}

fn state_from(task_id: &str, server: &PreviewServer) -> PreviewServerState {
    PreviewServerState {
        task_id: task_id.to_string(),
        port: server.port,
        url: format!("http://127.0.0.1:{}", server.port),
        running: !server.stop.load(Ordering::Acquire),
    }
}

fn spawn_server(
    root: PathBuf,
    task_id: &str,
    log: Arc<dyn Fn(&PreviewLogLine) + Send + Sync>,
) -> Result<(u16, Arc<AtomicBool>, Arc<Server>, JoinHandle<()>), String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Cannot resolve preview root: {error}"))?;
    let bound = Arc::new(
        Server::http(("127.0.0.1", 0))
            .map_err(|error| format!("Cannot bind preview server: {error}"))?,
    );
    let port = bound
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .unwrap_or(0);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let serve_server = bound.clone();
    let task = task_id.to_string();
    let handle = std::thread::spawn(move || {
        serve_loop(serve_server, root, task, stop_flag, log);
    });
    Ok((port, stop, bound, handle))
}

fn serve_loop(
    server: Arc<Server>,
    root: PathBuf,
    task_id: String,
    stop: Arc<AtomicBool>,
    log: Arc<dyn Fn(&PreviewLogLine) + Send + Sync>,
) {
    for request in server.incoming_requests() {
        if stop.load(Ordering::Acquire) {
            break;
        }
        handle_request(&root, &task_id, log.as_ref(), request);
    }
}

fn handle_request(
    root: &Path,
    task_id: &str,
    log: &(dyn Fn(&PreviewLogLine) + Send + Sync),
    request: tiny_http::Request,
) {
    let method = request.method().as_str().to_string();
    let raw_path = request.url().to_string();
    let (status, body, mime) = if method == "GET" {
        resolve_response(root, &raw_path)
    } else {
        (
            405,
            Vec::from(b"Method Not Allowed".as_slice()),
            "text/plain; charset=utf-8".to_string(),
        )
    };
    let path_display = normalize_request_path(&raw_path)
        .unwrap_or_else(|_| raw_path.clone())
        .trim_start_matches('/')
        .to_string();
    let path_display = if path_display.is_empty() {
        "/".to_string()
    } else {
        path_display
    };

    let bytes = body.len() as u64;
    let mut response = Response::from_data(body).with_status_code(status);
    let content_type = Header::from_bytes("Content-Type".as_bytes(), mime.as_bytes())
        .unwrap_or_else(|_| {
            Header::from_bytes("Content-Type".as_bytes(), b"application/octet-stream").unwrap()
        });
    response.add_header(content_type);
    response.add_header(
        Header::from_bytes("Content-Length".as_bytes(), bytes.to_string().as_bytes())
            .unwrap_or_else(|_| Header::from_bytes("X-Dummy".as_bytes(), b"1").unwrap()),
    );
    response.add_header(
        Header::from_bytes("Cache-Control".as_bytes(), b"no-store").expect("static header bytes"),
    );
    response.add_header(
        Header::from_bytes("X-Content-Type-Options".as_bytes(), b"nosniff")
            .expect("static header bytes"),
    );
    let _ = request.respond(response);

    let _ = log(&PreviewLogLine {
        task_id: task_id.to_string(),
        method,
        path: path_display.to_string(),
        status,
        bytes,
        mime,
    });
}

/// Resolve a GET request to a response. Returns `(status, body, mime)`.
fn resolve_response(root: &Path, raw_path: &str) -> (u16, Vec<u8>, String) {
    let relative = match normalize_request_path(raw_path) {
        Ok(relative) => relative,
        Err(()) => {
            return (
                400,
                Vec::from(b"Bad Request".as_slice()),
                "text/plain; charset=utf-8".to_string(),
            )
        }
    };

    let resolved = if relative.is_empty() {
        root.to_path_buf()
    } else {
        match resolve_within_root(root, &relative) {
            Some(resolved) => resolved,
            None => {
                return (
                    403,
                    Vec::from(b"Forbidden".as_slice()),
                    "text/plain; charset=utf-8".to_string(),
                );
            }
        }
    };

    if resolved.is_dir() {
        let index = resolved.join("index.html");
        if index.is_file() {
            return serve_file(&index);
        }
        return (
            403,
            Vec::from(b"Forbidden".as_slice()),
            "text/plain; charset=utf-8".to_string(),
        );
    }
    if !resolved.is_file() {
        return (
            404,
            Vec::from(b"Not Found".as_slice()),
            "text/plain; charset=utf-8".to_string(),
        );
    }
    serve_file(&resolved)
}

fn serve_file(path: &Path) -> (u16, Vec<u8>, String) {
    match fs::read(path) {
        Ok(bytes) => {
            let mime = mime_for_path(path).to_string();
            (200, bytes, mime)
        }
        Err(_) => (
            404,
            Vec::from(b"Not Found".as_slice()),
            "text/plain; charset=utf-8".to_string(),
        ),
    }
}

/// Percent-decode and normalize a request path. The leading slash is dropped so
/// the result is a workspace-relative path. Rejects absolute paths, `.`/`..`
/// components, and any other non-normal component.
fn normalize_request_path(raw: &str) -> Result<String, ()> {
    let path_only = raw
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_start_matches('/');
    let decoded = percent_decode(path_only).ok_or(())?;
    let path = Path::new(&decoded);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(());
    }
    Ok(decoded)
}

/// Resolve `root.join(relative)`, canonicalize, and reject any escape outside
/// the root (covers `..` and symlink escapes).
fn resolve_within_root(root: &Path, relative: &str) -> Option<PathBuf> {
    let candidate = root.join(relative);
    let canonical = candidate.canonicalize().ok()?;
    if !canonical.starts_with(root) {
        return None;
    }
    Some(canonical)
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hi = hex_val(bytes[index + 1])?;
                let lo = hex_val(bytes[index + 2])?;
                out.push((hi << 4) | lo);
                index += 3;
            }
            b'%' => return None,
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Open a preview origin in the system browser. Only our own localhost origins
/// are accepted so the command cannot be used as an arbitrary URL opener.
pub fn open_in_browser(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:")) {
        return Err("Refusing to open a non-preview URL".into());
    }
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Cannot open browser: {error}"))
}

fn append_preview_audit(
    database_path: &Path,
    task_id: &str,
    action: &str,
    port: u16,
    root: &Path,
) -> Result<(), String> {
    let connection = Database::open(database_path.to_path_buf())?.connection()?;
    let metadata = json!({
        "actor": "user",
        "port": port,
        "root": root.to_string_lossy(),
    });
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|error| format!("Serialize preview audit: {error}"))?;
    connection
        .execute(
            "INSERT INTO audit_log(actor, action, target, result, metadata_json, timestamp)
             VALUES ('user', ?1, ?2, 'ok', ?3, ?4)",
            params![action, task_id, metadata_json, unix_millis()?],
        )
        .map_err(|error| format!("Append preview audit log: {error}"))?;
    Ok(())
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("Clock skew: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent::protocol::TaskRuntimeProfile,
        storage::{
            app_paths::AppPaths,
            database::Database,
            task_repository::TaskRepository,
            tasks::{TaskDraft, TaskIsolation},
        },
    };
    use std::sync::mpsc;
    use uuid::Uuid;

    fn fixture(workspace: &Path) -> (AppPaths, String) {
        let root = std::env::temp_dir().join(format!("pi-preview-test-{}", Uuid::new_v4()));
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
        let task = TaskRepository::save(
            &paths.database_file,
            TaskDraft {
                id: None,
                title: Some("Preview".into()),
                cwd: workspace.display().to_string(),
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
        (paths, task.id)
    }

    #[test]
    fn serves_html_from_workspace_over_localhost() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-serve-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("index.html"), "<h1>Hello Preview</h1>").unwrap();

        let (tx, rx) = mpsc::channel::<PreviewLogLine>();
        let (port, _stop, unblock, handle) = spawn_server(
            workspace.clone(),
            "task-a",
            Arc::new(move |line: &PreviewLogLine| {
                let _ = tx.send(line.clone());
            }),
        )
        .unwrap();

        let url = format!("http://127.0.0.1:{port}/index.html");
        let body = reqwest::blocking::get(&url).unwrap().text().unwrap();
        assert!(body.contains("Hello Preview"));

        let line = rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        assert_eq!(line.status, 200);
        assert_eq!(line.path, "index.html");
        assert_eq!(line.task_id, "task-a");
        assert!(line.mime.starts_with("text/html"));

        unblock.unblock();
        let _ = handle.join();
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn serves_directory_index_html() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-index-{}", Uuid::new_v4()));
        fs::create_dir_all(workspace.join("app")).unwrap();
        fs::write(workspace.join("app/index.html"), "<p>Index</p>").unwrap();

        let (port, _stop, unblock, handle) =
            spawn_server(workspace.clone(), "", Arc::new(|_line: &PreviewLogLine| {})).unwrap();
        let url = format!("http://127.0.0.1:{port}/app/");
        let body = reqwest::blocking::get(&url).unwrap().text().unwrap();
        assert!(body.contains("Index"));

        unblock.unblock();
        let _ = handle.join();
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn rejects_parent_traversal() {
        let workspace =
            std::env::temp_dir().join(format!("pi-preview-traverse-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        let outside = workspace.parent().unwrap().join("secret.txt");
        fs::write(&outside, "secret").unwrap();

        let (port, _stop, unblock, handle) =
            spawn_server(workspace.clone(), "", Arc::new(|_line: &PreviewLogLine| {})).unwrap();
        let client = reqwest::blocking::Client::new();
        // Encoded traversal: "../secret.txt".
        let status = client
            .get(format!("http://127.0.0.1:{port}/%2e%2e/secret.txt"))
            .send()
            .unwrap()
            .status();
        assert!(status.is_client_error());

        unblock.unblock();
        let _ = handle.join();
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn rejects_symlink_escape() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-symlink-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        let outside_dir = workspace
            .parent()
            .unwrap()
            .join(format!("outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&outside_dir).unwrap();
        fs::write(outside_dir.join("leak.txt"), "leak").unwrap();
        std::os::unix::fs::symlink(&outside_dir, workspace.join("escape")).unwrap();

        let (port, _stop, unblock, handle) =
            spawn_server(workspace.clone(), "", Arc::new(|_line: &PreviewLogLine| {})).unwrap();
        let status = reqwest::blocking::get(format!("http://127.0.0.1:{port}/escape/leak.txt"))
            .unwrap()
            .status();
        assert_eq!(status.as_u16(), 403);

        unblock.unblock();
        let _ = handle.join();
        fs::remove_dir_all(workspace).unwrap();
        fs::remove_dir_all(outside_dir).unwrap();
    }

    #[test]
    fn rejects_non_get_methods() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-post-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("index.html"), "hello").unwrap();

        let (port, _stop, unblock, handle) =
            spawn_server(workspace.clone(), "", Arc::new(|_line: &PreviewLogLine| {})).unwrap();
        let client = reqwest::blocking::Client::new();
        let status = client
            .post(format!("http://127.0.0.1:{port}/index.html"))
            .send()
            .unwrap()
            .status();
        assert_eq!(status.as_u16(), 405);

        unblock.unblock();
        let _ = handle.join();
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn infers_mime_from_extension() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-mime-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("photo.png"), &[0, 1, 2, 3]).unwrap();
        fs::write(workspace.join("doc.pdf"), b"%PDF-1.4").unwrap();

        let (port, _stop, unblock, handle) =
            spawn_server(workspace.clone(), "", Arc::new(|_line: &PreviewLogLine| {})).unwrap();

        let client = reqwest::blocking::Client::new();
        let png = client
            .get(format!("http://127.0.0.1:{port}/photo.png"))
            .send()
            .unwrap();
        assert_eq!(
            png.headers().get("content-type").unwrap().to_str().unwrap(),
            "image/png"
        );
        let pdf = client
            .get(format!("http://127.0.0.1:{port}/doc.pdf"))
            .send()
            .unwrap();
        assert_eq!(
            pdf.headers().get("content-type").unwrap().to_str().unwrap(),
            "application/pdf"
        );

        unblock.unblock();
        let _ = handle.join();
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn manager_start_is_idempotent_and_stops() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-manager-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("index.html"), "ok").unwrap();
        let (paths, task_id) = fixture(&workspace);

        let manager = PreviewManager::default();
        let first = manager
            .start_with_log(
                &paths.database_file,
                &task_id,
                Arc::new(|_line: &PreviewLogLine| {}),
            )
            .unwrap();
        let second = manager
            .start_with_log(
                &paths.database_file,
                &task_id,
                Arc::new(|_line: &PreviewLogLine| {}),
            )
            .unwrap();
        assert_eq!(first.port, second.port);
        assert!(first.running);

        let status = manager.status(&task_id).unwrap();
        assert_eq!(status.port, first.port);

        manager.stop(&paths.database_file, &task_id).unwrap();
        assert!(manager.status(&task_id).is_none());

        // Can start again after stop.
        let again = manager
            .start_with_log(
                &paths.database_file,
                &task_id,
                Arc::new(|_line: &PreviewLogLine| {}),
            )
            .unwrap();
        assert!(again.running);
        manager.stop(&paths.database_file, &task_id).unwrap();

        fs::remove_dir_all(&workspace).unwrap();
        fs::remove_dir_all(paths.root.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_archived_tasks() {
        let workspace =
            std::env::temp_dir().join(format!("pi-preview-archived-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        let (paths, task_id) = fixture(&workspace);
        let connection = Database::open(paths.database_file.clone())
            .unwrap()
            .connection()
            .unwrap();
        connection
            .execute(
                "UPDATE tasks SET archived = 1 WHERE id = ?1",
                params![task_id],
            )
            .unwrap();

        let manager = PreviewManager::default();
        let result = manager.start_with_log(
            &paths.database_file,
            &task_id,
            Arc::new(|_line: &PreviewLogLine| {}),
        );
        assert!(result.is_err());

        fs::remove_dir_all(&workspace).unwrap();
        fs::remove_dir_all(paths.root.parent().unwrap()).unwrap();
    }

    #[test]
    fn start_and_stop_write_audit_rows() {
        let workspace = std::env::temp_dir().join(format!("pi-preview-audit-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("index.html"), "ok").unwrap();
        let (paths, task_id) = fixture(&workspace);

        let manager = PreviewManager::default();
        manager
            .start_with_log(
                &paths.database_file,
                &task_id,
                Arc::new(|_line: &PreviewLogLine| {}),
            )
            .unwrap();
        manager.stop(&paths.database_file, &task_id).unwrap();

        let connection = Database::open(paths.database_file.clone())
            .unwrap()
            .connection()
            .unwrap();
        let mut statement = connection
            .prepare("SELECT action FROM audit_log WHERE target = ?1 ORDER BY timestamp")
            .unwrap();
        let actions: Vec<String> = statement
            .query_map(params![task_id], |row| row.get(0))
            .unwrap()
            .map(|value| value.unwrap())
            .collect();
        assert_eq!(actions, vec!["preview.server_start", "preview.server_stop"]);

        fs::remove_dir_all(&workspace).unwrap();
        fs::remove_dir_all(paths.root.parent().unwrap()).unwrap();
    }
}
