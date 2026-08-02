mod agent;
mod broker;
mod git;
mod marketplace;
mod policy;
mod preview;
mod storage;
mod terminal;
mod updates;
mod workspace;

use agent::protocol::{
    command_envelope, DesktopBootstrap, DesktopHostState, DesktopShellSnapshot, DesktopStorageState,
};
use agent::supervisor::{AgentHostLaunch, AgentSupervisor};
use broker::service::BrokerService;
use core_graphics::access::ScreenCaptureAccess;
use git::repository::{inspect_repository, RepositoryInfo};
use git::worktree::{WorktreeInfo, WorktreeManager};
use marketplace::{MarketplacePage, MarketplaceQuery};
use preview::{open_in_browser, PreviewManager, PreviewServerState};
use serde::Serialize;
use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
use storage::attachments::{AttachmentStore, TaskAttachment};
use storage::connectors::{ConnectorDraft, ConnectorProfile, ConnectorStore, ConnectorTestResult};
use storage::database::Database;
use storage::endpoints::{
    EndpointDiscoveryDraft, EndpointDraft, EndpointProfileView, EndpointStore, EndpointTestResult,
};
use storage::event_store::{EventStore, TaskEventReplay};
use storage::extensions::{ExtensionDraft, ExtensionProfile, ExtensionScanResult, ExtensionStore};
use storage::project_repository::{ProjectRepository, ProjectSummary};
use storage::resources::{ResourceDraft, ResourceKind, ResourceProfile, ResourceStore};
use storage::task_repository::TaskRepository;
use storage::tasks::{TaskCreateDraft, TaskDraft, TaskIsolation, TaskRecord, TaskWorktree};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_notification::NotificationExt;
use terminal::{TerminalLaunch, TerminalManager};
use updates::{AutomaticUpdateReport, PiAgentUpdateStatus, UpdatePreferences};
use workspace::{
    WorkspaceDiff, WorkspaceFileContent, WorkspaceFileSearch, WorkspacePatchResult,
    WorkspaceSnapshot, WorkspaceWriteResult,
};

#[tauri::command]
fn desktop_bootstrap(app: tauri::AppHandle) -> Result<DesktopBootstrap, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    paths.ensure().map_err(|error| error.to_string())?;
    let storage = Database::initialize(&paths)?;

    Ok(DesktopBootstrap {
        app_data_dir: paths.root.display().to_string(),
        storage: DesktopStorageState {
            schema_version: storage.schema_version,
            imported_sources: storage.imported_sources,
            imported_records: storage.imported_records,
        },
        snapshot: DesktopShellSnapshot {
            status: "ready".into(),
            host: DesktopHostState {
                status: "idle".into(),
                runtime: "pi-agent-host".into(),
                version: None,
            },
            tasks: Vec::new(),
        },
    })
}

#[tauri::command]
async fn pi_agent_update_status(app: tauri::AppHandle) -> Result<PiAgentUpdateStatus, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let app_for_update = app.clone();
    tauri::async_runtime::spawn_blocking(move || updates::status(&app_for_update, &paths))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn update_preferences_get(app: tauri::AppHandle) -> Result<UpdatePreferences, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    updates::preferences(&paths)
}

#[tauri::command]
fn update_preferences_save(
    app: tauri::AppHandle,
    preferences: UpdatePreferences,
) -> Result<UpdatePreferences, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    updates::save_preferences(&paths, preferences)
}

#[tauri::command]
async fn pi_agent_update_install(app: tauri::AppHandle) -> Result<PiAgentUpdateStatus, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let app_for_update = app.clone();
    tauri::async_runtime::spawn_blocking(move || updates::install_latest(&app_for_update, &paths))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn automatic_updates(app: tauri::AppHandle) -> Result<AutomaticUpdateReport, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let app_for_update = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        updates::run_automatic_updates(&app_for_update, &paths)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn agent_host_start(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    broker: tauri::State<'_, BrokerService>,
) -> Result<AgentHostLaunch, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    let app_data_dir = paths.root.display().to_string();
    let launch = supervisor.start(
        &app,
        &app_data_dir,
        &paths.database_file,
        broker.inner().clone(),
        paths.clone(),
    )?;
    if let Err(error) = sync_endpoint_runtime(&app, &supervisor)
        .and_then(|_| sync_extension_runtime(&app, &supervisor))
        .and_then(|_| sync_connector_runtime(&app, &supervisor))
    {
        let _ = supervisor.stop();
        return Err(error);
    }
    Ok(launch)
}

#[tauri::command]
fn task_event_replay(
    app: tauri::AppHandle,
    task_id: String,
    after_event_id: Option<i64>,
    limit: Option<u32>,
) -> Result<TaskEventReplay, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    EventStore::open(&paths.database_file)?.replay(&task_id, after_event_id, limit)
}

#[tauri::command]
fn workspace_snapshot(app: tauri::AppHandle, task_id: String) -> Result<WorkspaceSnapshot, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    workspace::snapshot(&paths.database_file, &task_id)
}

#[tauri::command]
fn workspace_file_read(
    app: tauri::AppHandle,
    task_id: String,
    relative_path: String,
) -> Result<WorkspaceFileContent, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    workspace::read_file(&paths.database_file, &task_id, &relative_path)
}

#[tauri::command]
fn workspace_file_write(
    app: tauri::AppHandle,
    task_id: String,
    relative_path: String,
    content: String,
    base_hash: Option<String>,
) -> Result<WorkspaceWriteResult, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    workspace::write_file(
        &paths,
        &task_id,
        &relative_path,
        &content,
        base_hash.as_deref(),
    )
}

#[tauri::command]
fn workspace_file_search(
    app: tauri::AppHandle,
    task_id: String,
    query: String,
) -> Result<WorkspaceFileSearch, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    workspace::search_files(&paths.database_file, &task_id, &query)
}

#[tauri::command]
fn workspace_diff_read(
    app: tauri::AppHandle,
    task_id: String,
    relative_path: Option<String>,
) -> Result<WorkspaceDiff, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    workspace::diff(&paths.database_file, &task_id, relative_path.as_deref())
}

#[tauri::command]
fn workspace_diff_apply(
    app: tauri::AppHandle,
    task_id: String,
    relative_path: String,
    operation: String,
    hunk_body: Option<String>,
    old_start: Option<usize>,
    old_lines: Option<usize>,
    new_start: Option<usize>,
    new_lines: Option<usize>,
) -> Result<WorkspacePatchResult, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    workspace::apply::apply_patch(
        &paths,
        &task_id,
        &relative_path,
        &operation,
        hunk_body.as_deref(),
        old_start,
        old_lines,
        new_start,
        new_lines,
    )
}

#[tauri::command]
fn git_repository_inspect(project_path: String) -> Result<RepositoryInfo, String> {
    inspect_repository(std::path::Path::new(&project_path))
}

#[tauri::command]
fn preview_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, PreviewManager>,
    task_id: String,
) -> Result<PreviewServerState, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    manager.start(&app, &paths.database_file, &task_id)
}

#[tauri::command]
fn preview_stop(
    app: tauri::AppHandle,
    manager: tauri::State<'_, PreviewManager>,
    task_id: String,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    manager.stop(&paths.database_file, &task_id)
}

#[tauri::command]
fn preview_status(
    manager: tauri::State<'_, PreviewManager>,
    task_id: String,
) -> Result<Option<PreviewServerState>, String> {
    Ok(manager.status(&task_id))
}

#[tauri::command]
fn preview_open(url: String) -> Result<(), String> {
    open_in_browser(&url)
}

#[tauri::command]
fn app_notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|error| format!("Cannot show notification: {error}"))
}

#[tauri::command]
fn app_set_badge(app: tauri::AppHandle, count: u64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No main window for badge".to_string())?;
    window
        .set_badge_count(if count > 0 { Some(count as i64) } else { None })
        .map_err(|error| format!("Cannot set dock badge: {error}"))
}

#[tauri::command]
fn quick_entry_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick-entry") {
        window
            .hide()
            .map_err(|error| format!("Cannot hide quick entry: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn git_worktree_create(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WorktreeManager>,
    project_path: String,
    task_id: String,
) -> Result<WorktreeInfo, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    manager.create(
        std::path::Path::new(&project_path),
        &task_id,
        &paths.worktrees,
        &paths.database_file,
    )
}

#[tauri::command]
fn git_worktree_inspect(
    manager: tauri::State<'_, WorktreeManager>,
    worktree_path: String,
    task_id: String,
) -> Result<WorktreeInfo, String> {
    manager.inspect(std::path::Path::new(&worktree_path), &task_id)
}

#[tauri::command]
fn git_worktree_remove(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WorktreeManager>,
    worktree_path: String,
    task_id: String,
    delete_branch: bool,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    manager.remove(
        std::path::Path::new(&worktree_path),
        &task_id,
        &paths.worktrees,
        &paths.database_file,
        delete_branch,
    )
}

#[tauri::command]
fn agent_host_send(
    supervisor: tauri::State<'_, AgentSupervisor>,
    broker: tauri::State<'_, BrokerService>,
    message: Value,
) -> Result<(), String> {
    match message.get("type").and_then(Value::as_str) {
        Some("task.permission.respond") => {
            let task_id = message
                .get("taskId")
                .and_then(Value::as_str)
                .ok_or_else(|| "Permission response has no taskId".to_string())?;
            let request_id = message
                .get("requestId")
                .and_then(Value::as_str)
                .ok_or_else(|| "Permission response has no requestId".to_string())?;
            let approved = message
                .get("approved")
                .and_then(Value::as_bool)
                .ok_or_else(|| "Permission response has no decision".to_string())?;
            broker.resolve_permission(task_id, request_id, approved)?;
        }
        Some("task.abort" | "task.close") => {
            if let Some(task_id) = message.get("taskId").and_then(Value::as_str) {
                broker.revoke_task(task_id)?;
            }
        }
        _ => {}
    }
    supervisor.send(message)
}

#[tauri::command]
fn agent_host_stop(
    supervisor: tauri::State<'_, AgentSupervisor>,
    broker: tauri::State<'_, BrokerService>,
) -> Result<(), String> {
    broker.revoke_all()?;
    supervisor.stop()
}

#[tauri::command]
fn task_list(app: tauri::AppHandle, include_archived: bool) -> Result<Vec<TaskRecord>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::list(&paths.database_file, include_archived)
}

#[tauri::command]
fn project_list(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    ProjectRepository::list(&paths.database_file)
}

#[tauri::command]
fn scratch_workspace_create(app: tauri::AppHandle) -> Result<String, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    paths.ensure().map_err(|error| error.to_string())?;
    let scratch = paths
        .root
        .join("scratch")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&scratch)
        .map_err(|error| format!("create scratch workspace: {error}"))?;
    std::fs::set_permissions(&scratch, std::fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("secure scratch workspace: {error}"))?;
    Ok(scratch.display().to_string())
}

#[tauri::command]
fn project_instructions_save(
    app: tauri::AppHandle,
    id: String,
    instructions: String,
) -> Result<ProjectSummary, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    ProjectRepository::save_instructions(&paths.database_file, &id, instructions)
}

#[tauri::command]
fn task_save(app: tauri::AppHandle, draft: TaskDraft) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::save(&paths.database_file, draft)
}

#[tauri::command]
fn task_create(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WorktreeManager>,
    draft: TaskCreateDraft,
) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    let task_id = uuid::Uuid::new_v4().to_string();
    let mut profile = draft.profile;
    if draft.isolation == TaskIsolation::ReadOnly {
        profile.permission_mode = "plan".into();
    }

    let (cwd, project_root, worktree) = match draft.isolation {
        TaskIsolation::Worktree => {
            let info = manager.create(
                std::path::Path::new(&draft.project_path),
                &task_id,
                &paths.worktrees,
                &paths.database_file,
            )?;
            (
                info.worktree_path.clone(),
                info.repository_root.clone(),
                Some(TaskWorktree {
                    repository_root: info.repository_root,
                    worktree_path: info.worktree_path,
                    branch: info.branch,
                    baseline: info.baseline,
                }),
            )
        }
        TaskIsolation::CurrentCheckout | TaskIsolation::ReadOnly => {
            (draft.project_path.clone(), draft.project_path.clone(), None)
        }
    };

    let task = TaskRepository::save(
        &paths.database_file,
        TaskDraft {
            id: Some(task_id.clone()),
            title: draft.title,
            cwd: cwd.clone(),
            project_root: Some(project_root),
            isolation: Some(draft.isolation.clone()),
            worktree,
            profile,
        },
    );
    match task {
        Ok(task) => Ok(task),
        Err(error) => {
            if draft.isolation == TaskIsolation::Worktree {
                let rollback = manager.remove(
                    std::path::Path::new(&cwd),
                    &task_id,
                    &paths.worktrees,
                    &paths.database_file,
                    true,
                );
                if let Err(rollback_error) = rollback {
                    return Err(format!(
                        "Task persistence failed: {error}. Worktree rollback also failed: {rollback_error}"
                    ));
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn task_touch(app: tauri::AppHandle, id: String) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::touch(&paths.database_file, &id)
}

#[tauri::command]
fn task_archive(
    app: tauri::AppHandle,
    terminal: tauri::State<'_, TerminalManager>,
    id: String,
    archived: bool,
) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    let task = TaskRepository::archive(&paths.database_file, &id, archived)?;
    if archived {
        terminal.stop(&id)?;
    }
    Ok(task)
}

#[tauri::command]
fn task_rename(app: tauri::AppHandle, id: String, title: String) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::rename(&paths.database_file, &id, &title)
}

#[tauri::command]
fn task_pin(app: tauri::AppHandle, id: String, pinned: bool) -> Result<TaskRecord, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    TaskRepository::pin(&paths.database_file, &id, pinned)
}

#[tauri::command]
fn task_search(app: tauri::AppHandle, query: String) -> Result<Vec<TaskRecord>, String> {
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

#[tauri::command]
fn terminal_start(
    app: tauri::AppHandle,
    terminal: tauri::State<'_, TerminalManager>,
    task_id: String,
) -> Result<TerminalLaunch, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    let task = TaskRepository::get(&paths.database_file, &task_id)?
        .ok_or_else(|| format!("Unknown task: {task_id}"))?;
    if task.archived {
        return Err(format!("Task is archived: {task_id}"));
    }
    terminal.start(&app, &task_id, std::path::Path::new(&task.cwd))
}

#[tauri::command]
fn terminal_input(
    terminal: tauri::State<'_, TerminalManager>,
    task_id: String,
    data: String,
) -> Result<(), String> {
    terminal.write(&task_id, &data)
}

#[tauri::command]
fn terminal_resize(
    terminal: tauri::State<'_, TerminalManager>,
    task_id: String,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    terminal.resize(&task_id, columns, rows)
}

#[tauri::command]
fn terminal_stop(
    terminal: tauri::State<'_, TerminalManager>,
    task_id: String,
) -> Result<(), String> {
    terminal.stop(&task_id)
}

#[tauri::command]
fn attachment_list(app: tauri::AppHandle, task_id: String) -> Result<Vec<TaskAttachment>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    AttachmentStore::list(&paths.database_file, &task_id)
}

#[tauri::command]
async fn attachment_pick(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<Vec<TaskAttachment>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    let app_for_picker = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_for_picker
            .dialog()
            .file()
            .set_title("Attach Files to Pi")
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|error| error.to_string())??;
    AttachmentStore::import(&paths, &task_id, &picked)
}

#[tauri::command]
async fn attachment_screenshot(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<TaskAttachment, String> {
    if !ScreenCaptureAccess::default().preflight() {
        return Err("SCREEN_RECORDING_PERMISSION_DENIED".to_string());
    }
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;

    // Hide the quick-entry window so the captured screen shows the user's work.
    if let Some(window) = app.get_webview_window("quick-entry") {
        let _ = window.hide();
    }

    let destination =
        std::env::temp_dir().join(format!("pi-screenshot-{}.png", uuid::Uuid::new_v4()));
    let destination_for_spawn = destination.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-o"])
            .arg(&destination_for_spawn)
            .output()
            .map_err(|error| format!("Cannot capture screen: {error}"))
    })
    .await
    .map_err(|error| error.to_string())??;

    if !output.status.success() || !destination.exists() {
        return Err("Screen capture failed to produce an image".to_string());
    }

    let mut imported = AttachmentStore::import(&paths, &task_id, &[destination.clone()])?;
    let _ = std::fs::remove_file(&destination);
    imported
        .pop()
        .ok_or_else(|| "Screen capture produced no attachment".to_string())
}

#[tauri::command]
fn attachment_delete(app: tauri::AppHandle, task_id: String, id: String) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    Database::initialize(&paths)?;
    AttachmentStore::delete(&paths, &task_id, &id)
}

#[tauri::command]
fn endpoint_list(app: tauri::AppHandle) -> Result<Vec<EndpointProfileView>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    EndpointStore::list(&paths.endpoints_file)
}

#[tauri::command]
fn endpoint_save(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    draft: EndpointDraft,
) -> Result<EndpointProfileView, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let endpoint = EndpointStore::save(&paths.endpoints_file, draft)?;
    sync_endpoint_runtime(&app, &supervisor)?;
    Ok(endpoint)
}

#[tauri::command]
fn endpoint_delete(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    EndpointStore::delete(&paths.endpoints_file, &id)?;
    sync_endpoint_runtime(&app, &supervisor)
}

#[tauri::command]
async fn endpoint_test(app: tauri::AppHandle, id: String) -> Result<EndpointTestResult, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let path = paths.endpoints_file;
    tauri::async_runtime::spawn_blocking(move || EndpointStore::test(&path, &id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn endpoint_discover(
    app: tauri::AppHandle,
    draft: EndpointDiscoveryDraft,
) -> Result<EndpointTestResult, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let path = paths.endpoints_file;
    tauri::async_runtime::spawn_blocking(move || EndpointStore::discover(&path, draft))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn extension_list(app: tauri::AppHandle) -> Result<Vec<ExtensionProfile>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ExtensionStore::list(&paths.extensions_file)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionUpdate {
    id: String,
    package_name: String,
    current_version: String,
    latest_version: String,
    update_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
async fn extension_updates(app: tauri::AppHandle) -> Result<Vec<ExtensionUpdate>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let profiles = ExtensionStore::list(&paths.extensions_file)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<Vec<_>, String>(
            profiles
                .into_iter()
                .filter_map(|extension| {
                    Some((
                        extension.id,
                        extension.package_name?,
                        extension.package_version?,
                    ))
                })
                .map(|(id, package_name, current_version)| {
                    match marketplace::latest_version(&package_name) {
                        Ok(latest_version) => ExtensionUpdate {
                            id,
                            package_name,
                            update_available: current_version != latest_version,
                            current_version,
                            latest_version,
                            error: None,
                        },
                        Err(error) => ExtensionUpdate {
                            id,
                            package_name,
                            latest_version: current_version.clone(),
                            current_version,
                            update_available: false,
                            error: Some(error),
                        },
                    }
                })
                .collect(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn extension_scan(source_path: String) -> Result<ExtensionScanResult, String> {
    ExtensionStore::scan(&source_path)
}

#[tauri::command]
async fn marketplace_list(query: MarketplaceQuery) -> Result<MarketplacePage, String> {
    tauri::async_runtime::spawn_blocking(move || marketplace::fetch_catalog(query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn marketplace_install(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    package_name: String,
    version: Option<String>,
) -> Result<ExtensionProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    paths.ensure().map_err(|error| error.to_string())?;
    let app_for_install = app.clone();
    let paths_for_install = paths.clone();
    let extension = tauri::async_runtime::spawn_blocking(move || {
        let prepared = marketplace::prepare_npm_package(
            &app_for_install,
            &paths_for_install,
            &package_name,
            version.as_deref(),
        )?;
        ExtensionStore::install_marketplace(
            &paths_for_install.extensions_file,
            &paths_for_install.extension_packages,
            prepared,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    sync_extension_runtime(&app, &supervisor)?;
    Ok(extension)
}

#[tauri::command]
async fn extension_update(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
) -> Result<ExtensionProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let profile = ExtensionStore::list(&paths.extensions_file)?
        .into_iter()
        .find(|extension| extension.id == id)
        .ok_or_else(|| format!("Unknown extension: {id}"))?;
    let package_name = profile.package_name.ok_or_else(|| {
        "Only npm marketplace extensions can be updated automatically".to_string()
    })?;
    let app_for_install = app.clone();
    let paths_for_install = paths.clone();
    let extension = tauri::async_runtime::spawn_blocking(move || {
        let latest_version = marketplace::latest_version(&package_name)?;
        let prepared = marketplace::prepare_npm_package(
            &app_for_install,
            &paths_for_install,
            &package_name,
            Some(&latest_version),
        )?;
        ExtensionStore::install_marketplace(
            &paths_for_install.extensions_file,
            &paths_for_install.extension_packages,
            prepared,
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    sync_extension_runtime(&app, &supervisor)?;
    Ok(extension)
}

#[tauri::command]
async fn project_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a Project Folder")
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|path| path.display().to_string())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn extension_pick_path(
    app: tauri::AppHandle,
    directory: bool,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.dialog().file().set_title(if directory {
            "Choose Pi Extension Folder"
        } else {
            "Choose Pi Extension File"
        });
        let picked = if directory {
            picker.blocking_pick_folder()
        } else {
            picker
                .add_filter("Pi Extension", &["js", "mjs", "cjs", "ts", "tsx"])
                .blocking_pick_file()
        };
        picked
            .map(|path| {
                path.into_path()
                    .map(|path| path.display().to_string())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn resource_list(
    app: tauri::AppHandle,
    kind: Option<String>,
) -> Result<Vec<ResourceProfile>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ResourceStore::list(&paths.resources_file, parse_resource_kind(kind.as_deref()))
}

#[tauri::command]
fn resource_save(app: tauri::AppHandle, draft: ResourceDraft) -> Result<ResourceProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ResourceStore::save(&paths, draft)
}

#[tauri::command]
fn resource_set_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<ResourceProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ResourceStore::set_enabled(&paths, &id, enabled)
}

#[tauri::command]
fn resource_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ResourceStore::delete(&paths, &id)
}

#[tauri::command]
async fn resource_import(
    app: tauri::AppHandle,
    kind: String,
) -> Result<Option<ResourceProfile>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let app_for_picker = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_for_picker
            .dialog()
            .file()
            .set_title("Import Skill / Prompt")
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok())
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(source_path) = picked else {
        return Ok(None);
    };
    let kind =
        parse_resource_kind(Some(&kind)).ok_or_else(|| format!("Unknown resource kind: {kind}"))?;
    ResourceStore::import(&paths, &source_path, kind).map(Some)
}

#[tauri::command]
async fn resource_export(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let content = ResourceStore::export_content(&paths.resources_file, &id)?;
    let app_for_dialog = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app_for_dialog
            .dialog()
            .file()
            .set_title("Export Resource")
            .blocking_save_file()
            .and_then(|path| path.into_path().ok());
        if let Some(destination) = destination {
            std::fs::write(&destination, content).map_err(|error| {
                format!(
                    "Cannot export resource to {}: {error}",
                    destination.display()
                )
            })?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn parse_resource_kind(value: Option<&str>) -> Option<ResourceKind> {
    match value {
        Some("skill") => Some(ResourceKind::Skill),
        Some("prompt") => Some(ResourceKind::Prompt),
        _ => None,
    }
}

#[tauri::command]
fn connector_list(app: tauri::AppHandle) -> Result<Vec<ConnectorProfile>, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ConnectorStore::list(&paths.connectors_file)
}

#[tauri::command]
fn connector_save(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    draft: ConnectorDraft,
) -> Result<ConnectorProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let saved = ConnectorStore::save(&paths, draft)?;
    sync_connector_runtime(&app, &supervisor)?;
    Ok(saved)
}

#[tauri::command]
fn connector_set_enabled(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
    enabled: bool,
) -> Result<ConnectorProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let updated = ConnectorStore::set_enabled(&paths, &id, enabled)?;
    sync_connector_runtime(&app, &supervisor)?;
    Ok(updated)
}

#[tauri::command]
fn connector_delete(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ConnectorStore::delete(&paths, &id)?;
    sync_connector_runtime(&app, &supervisor)
}

#[tauri::command]
fn connector_test(app: tauri::AppHandle, id: String) -> Result<ConnectorTestResult, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ConnectorStore::test(&paths, &id)
}

fn sync_connector_runtime(
    app: &tauri::AppHandle,
    supervisor: &AgentSupervisor,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(app).map_err(|error| error.to_string())?;
    let connectors = ConnectorStore::runtime_configs(&paths.connectors_file)?;
    supervisor.try_send(command_envelope(
        "host.configureConnectors",
        serde_json::json!({ "connectors": connectors }),
    )?)?;
    Ok(())
}

#[tauri::command]
fn extension_save(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    draft: ExtensionDraft,
) -> Result<ExtensionProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let extension = ExtensionStore::save(&paths.extensions_file, &paths.extension_packages, draft)?;
    sync_extension_runtime(&app, &supervisor)?;
    Ok(extension)
}

#[tauri::command]
fn extension_set_enabled(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
    enabled: bool,
    approved_content_hash: Option<String>,
) -> Result<ExtensionProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let extension = ExtensionStore::set_enabled(
        &paths.extensions_file,
        &id,
        enabled,
        approved_content_hash.as_deref(),
    )?;
    sync_extension_runtime(&app, &supervisor)?;
    Ok(extension)
}

#[tauri::command]
fn extension_activate_version(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
    content_hash: String,
) -> Result<ExtensionProfile, String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    let extension = ExtensionStore::activate_version(&paths.extensions_file, &id, &content_hash)?;
    sync_extension_runtime(&app, &supervisor)?;
    Ok(extension)
}

#[tauri::command]
fn extension_delete(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, AgentSupervisor>,
    id: String,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(&app).map_err(|error| error.to_string())?;
    ExtensionStore::delete(&paths.extensions_file, &id)?;
    sync_extension_runtime(&app, &supervisor)
}

fn sync_endpoint_runtime(
    app: &tauri::AppHandle,
    supervisor: &AgentSupervisor,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(app).map_err(|error| error.to_string())?;
    let endpoints = EndpointStore::runtime_configs(&paths.endpoints_file)?;
    supervisor.try_send(command_envelope(
        "host.configureEndpoints",
        serde_json::json!({ "endpoints": endpoints }),
    )?)?;
    Ok(())
}

fn sync_extension_runtime(
    app: &tauri::AppHandle,
    supervisor: &AgentSupervisor,
) -> Result<(), String> {
    let paths = storage::app_paths::AppPaths::resolve(app).map_err(|error| error.to_string())?;
    let extensions = ExtensionStore::runtime_configs(&paths.extensions_file)?;
    supervisor.try_send(command_envelope(
        "host.configureExtensions",
        serde_json::json!({ "extensions": extensions }),
    )?)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentSupervisor::default())
        .manage(BrokerService::default())
        .manage(WorktreeManager::default())
        .manage(TerminalManager::default())
        .manage(PreviewManager::default())
        .invoke_handler(tauri::generate_handler![
            desktop_bootstrap,
            pi_agent_update_status,
            update_preferences_get,
            update_preferences_save,
            pi_agent_update_install,
            automatic_updates,
            agent_host_start,
            agent_host_send,
            agent_host_stop,
            preview_start,
            preview_stop,
            preview_status,
            preview_open,
            app_notify,
            app_set_badge,
            quick_entry_hide,
            task_list,
            project_list,
            scratch_workspace_create,
            project_instructions_save,
            task_create,
            task_save,
            task_touch,
            task_archive,
            task_rename,
            task_pin,
            task_search,
            task_delete,
            task_event_replay,
            attachment_list,
            attachment_pick,
            attachment_screenshot,
            attachment_delete,
            terminal_start,
            terminal_input,
            terminal_resize,
            terminal_stop,
            workspace_snapshot,
            workspace_file_read,
            workspace_file_write,
            workspace_file_search,
            workspace_diff_read,
            workspace_diff_apply,
            git_repository_inspect,
            git_worktree_create,
            git_worktree_inspect,
            git_worktree_remove,
            endpoint_list,
            endpoint_save,
            endpoint_delete,
            endpoint_test,
            endpoint_discover,
            project_pick_folder,
            extension_list,
            extension_updates,
            extension_scan,
            marketplace_list,
            marketplace_install,
            extension_pick_path,
            extension_save,
            extension_set_enabled,
            extension_update,
            extension_activate_version,
            extension_delete,
            resource_list,
            resource_save,
            resource_set_enabled,
            resource_delete,
            resource_import,
            resource_export,
            connector_list,
            connector_save,
            connector_set_enabled,
            connector_delete,
            connector_test
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::ShortcutState;
            let handle = app.handle().clone();
            handle.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+Space",
                move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("quick-entry") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("quick-entry-open", ());
                    }
                },
            )?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                let _ = window.state::<AgentSupervisor>().stop();
                let _ = window.state::<TerminalManager>().stop_all();
                window.state::<PreviewManager>().stop_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Pi Desktop");
}
