import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentHostLaunch,
  AgentHostLifecycle,
  AgentHostLog,
  AutomaticUpdateReport,
  DesktopBootstrap,
  DesktopToHostMessage,
  EndpointDraft,
  EndpointDiscoveryDraft,
  EndpointProfile,
  EndpointTestResult,
  ExtensionDraft,
  ExtensionProfile,
  ExtensionScanResult,
  ExtensionUpdate,
  MarketplacePage,
  MarketplaceSort,
  HostToDesktopMessage,
  PiAgentUpdateStatus,
  PersistedTask,
  ProjectSummary,
  PersistedTaskDraft,
  PreviewLogLine,
  PreviewServerState,
  RepositoryInfo,
  TaskAttachment,
  TaskEventReplay,
  TaskCreateDraft,
  TerminalExit,
  TerminalLaunch,
  TerminalOutput,
  UpdatePreferences,
  WorkspaceDiff,
  WorkspaceFileContent,
  WorkspaceFileSearch,
  WorkspaceHunkOperation,
  WorkspaceHunkRef,
  WorkspacePatchResult,
  WorkspaceSnapshot,
  WorkspaceWriteResult,
  WorktreeInfo,
} from "@pi-desktop/protocol";
import { createDesktopCommand } from "@pi-desktop/protocol";

const HOST_MESSAGE_EVENT = "agent-host-message";
const HOST_LIFECYCLE_EVENT = "agent-host-lifecycle";
const HOST_LOG_EVENT = "agent-host-log";
const TERMINAL_OUTPUT_EVENT = "terminal-output";
const TERMINAL_EXIT_EVENT = "terminal-exit";
const PREVIEW_LOG_EVENT = "preview-log";

export async function invokeDesktopBootstrap(): Promise<DesktopBootstrap> {
  return invoke<DesktopBootstrap>("desktop_bootstrap");
}

export async function getPiAgentUpdateStatus(): Promise<PiAgentUpdateStatus> {
  return invoke<PiAgentUpdateStatus>("pi_agent_update_status");
}

export async function getUpdatePreferences(): Promise<UpdatePreferences> {
  return invoke<UpdatePreferences>("update_preferences_get");
}

export async function saveUpdatePreferences(
  preferences: UpdatePreferences,
): Promise<UpdatePreferences> {
  return invoke<UpdatePreferences>("update_preferences_save", {
    preferences,
  });
}

export async function installPiAgentUpdate(): Promise<PiAgentUpdateStatus> {
  return invoke<PiAgentUpdateStatus>("pi_agent_update_install");
}

export async function runAutomaticUpdates(): Promise<AutomaticUpdateReport> {
  return invoke<AutomaticUpdateReport>("automatic_updates");
}

export async function startAgentHost(): Promise<AgentHostLaunch> {
  return invoke<AgentHostLaunch>("agent_host_start");
}

export async function sendAgentHostMessage(
  message: DesktopToHostMessage,
): Promise<void> {
  return invoke("agent_host_send", { message });
}

export async function getSessionTree(taskId: string): Promise<void> {
  return invoke("agent_host_send", {
    message: createDesktopCommand({ type: "task.getTree", taskId }),
  });
}

export async function stopAgentHost(): Promise<void> {
  return invoke("agent_host_stop");
}

export async function listTasks(
  includeArchived = false,
): Promise<PersistedTask[]> {
  return invoke<PersistedTask[]>("task_list", { includeArchived });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>("project_list");
}

export async function saveProjectInstructions(
  id: string,
  instructions: string,
): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("project_instructions_save", { id, instructions });
}

export async function createScratchWorkspace(): Promise<string> {
  return invoke<string>("scratch_workspace_create");
}

export async function saveTask(
  draft: PersistedTaskDraft,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_save", { draft });
}

export async function createTask(
  draft: TaskCreateDraft,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_create", { draft });
}

export async function touchTask(id: string): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_touch", { id });
}

export async function archiveTask(
  id: string,
  archived: boolean,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_archive", { id, archived });
}

export async function renameTask(
  id: string,
  title: string,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_rename", { id, title });
}

export async function pinTask(
  id: string,
  pinned: boolean,
): Promise<PersistedTask> {
  return invoke<PersistedTask>("task_pin", { id, pinned });
}

export async function searchTasks(
  query: string,
): Promise<PersistedTask[]> {
  return invoke<PersistedTask[]>("task_search", { query });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke("task_delete", { id });
}

export async function listAttachments(
  taskId: string,
): Promise<TaskAttachment[]> {
  return invoke<TaskAttachment[]>("attachment_list", { taskId });
}

export async function pickAttachments(
  taskId: string,
): Promise<TaskAttachment[]> {
  return invoke<TaskAttachment[]>("attachment_pick", { taskId });
}

export async function captureScreenshotAttachment(
  taskId: string,
): Promise<TaskAttachment> {
  return invoke<TaskAttachment>("attachment_screenshot", { taskId });
}

export async function hideQuickEntryWindow(): Promise<void> {
  return invoke("quick_entry_hide");
}

export async function deleteAttachment(
  taskId: string,
  id: string,
): Promise<void> {
  return invoke("attachment_delete", { taskId, id });
}

export async function startUserTerminal(
  taskId: string,
): Promise<TerminalLaunch> {
  return invoke<TerminalLaunch>("terminal_start", { taskId });
}

export async function writeUserTerminal(
  taskId: string,
  data: string,
): Promise<void> {
  return invoke("terminal_input", { taskId, data });
}

export async function resizeUserTerminal(
  taskId: string,
  columns: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { taskId, columns, rows });
}

export async function stopUserTerminal(taskId: string): Promise<void> {
  return invoke("terminal_stop", { taskId });
}

export async function listenToUserTerminal(options: {
  onOutput: (output: TerminalOutput) => void;
  onExit: (exit: TerminalExit) => void;
}): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<TerminalOutput>(TERMINAL_OUTPUT_EVENT, (event) => {
      options.onOutput(event.payload);
    }),
    listen<TerminalExit>(TERMINAL_EXIT_EVENT, (event) => {
      options.onExit(event.payload);
    }),
  ]);
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

export async function startPreview(taskId: string): Promise<PreviewServerState> {
  return invoke<PreviewServerState>("preview_start", { taskId });
}

export async function stopPreview(taskId: string): Promise<void> {
  return invoke("preview_stop", { taskId });
}

export async function getPreviewStatus(
  taskId: string,
): Promise<PreviewServerState | null> {
  return invoke<PreviewServerState | null>("preview_status", { taskId });
}

export async function listenToPreview(options: {
  onLog: (line: PreviewLogLine) => void;
}): Promise<UnlistenFn> {
  return listen<PreviewLogLine>(PREVIEW_LOG_EVENT, (event) => {
    options.onLog(event.payload);
  });
}

export async function openPreviewInBrowser(url: string): Promise<void> {
  return invoke("preview_open", { url });
}

export async function appNotify(title: string, body: string): Promise<void> {
  return invoke("app_notify", { title, body });
}

export async function appSetBadge(count: number): Promise<void> {
  return invoke("app_set_badge", { count });
}

export async function replayTaskEvents(
  taskId: string,
  afterEventId?: number,
  limit?: number,
): Promise<TaskEventReplay> {
  return invoke<TaskEventReplay>("task_event_replay", {
    taskId,
    afterEventId,
    limit,
  });
}

export async function getWorkspaceSnapshot(
  taskId: string,
): Promise<WorkspaceSnapshot> {
  return invoke<WorkspaceSnapshot>("workspace_snapshot", { taskId });
}

export async function readWorkspaceFile(
  taskId: string,
  relativePath: string,
): Promise<WorkspaceFileContent> {
  return invoke<WorkspaceFileContent>("workspace_file_read", {
    taskId,
    relativePath,
  });
}

export async function readWorkspaceDiff(
  taskId: string,
  relativePath?: string,
): Promise<WorkspaceDiff> {
  return invoke<WorkspaceDiff>("workspace_diff_read", {
    taskId,
    relativePath,
  });
}

export async function applyWorkspacePatch(
  taskId: string,
  relativePath: string,
  operation: WorkspaceHunkOperation,
  hunk?: WorkspaceHunkRef,
): Promise<WorkspacePatchResult> {
  return invoke<WorkspacePatchResult>("workspace_diff_apply", {
    taskId,
    relativePath,
    operation,
    hunkBody: hunk?.body,
    oldStart: hunk?.oldStart,
    oldLines: hunk?.oldLines,
    newStart: hunk?.newStart,
    newLines: hunk?.newLines,
  });
}

export async function writeWorkspaceFile(
  taskId: string,
  relativePath: string,
  content: string,
  baseHash: string,
): Promise<WorkspaceWriteResult> {
  return invoke<WorkspaceWriteResult>("workspace_file_write", {
    taskId,
    relativePath,
    content,
    baseHash,
  });
}

export async function searchWorkspaceFiles(
  taskId: string,
  query: string,
): Promise<WorkspaceFileSearch> {
  return invoke<WorkspaceFileSearch>("workspace_file_search", {
    taskId,
    query,
  });
}

export async function inspectGitRepository(
  projectPath: string,
): Promise<RepositoryInfo> {
  return invoke<RepositoryInfo>("git_repository_inspect", { projectPath });
}

export async function createGitWorktree(
  projectPath: string,
  taskId: string,
): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("git_worktree_create", { projectPath, taskId });
}

export async function inspectGitWorktree(
  worktreePath: string,
  taskId: string,
): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("git_worktree_inspect", {
    worktreePath,
    taskId,
  });
}

export async function removeGitWorktree(
  worktreePath: string,
  taskId: string,
  deleteBranch: boolean,
): Promise<void> {
  return invoke("git_worktree_remove", {
    worktreePath,
    taskId,
    deleteBranch,
  });
}

export async function listEndpoints(): Promise<EndpointProfile[]> {
  return invoke<EndpointProfile[]>("endpoint_list");
}

export async function saveEndpoint(
  draft: EndpointDraft,
): Promise<EndpointProfile> {
  return invoke<EndpointProfile>("endpoint_save", { draft });
}

export async function deleteEndpoint(id: string): Promise<void> {
  return invoke("endpoint_delete", { id });
}

export async function testEndpoint(id: string): Promise<EndpointTestResult> {
  return invoke<EndpointTestResult>("endpoint_test", { id });
}

export async function discoverEndpoint(
  draft: EndpointDiscoveryDraft,
): Promise<EndpointTestResult> {
  return invoke<EndpointTestResult>("endpoint_discover", { draft });
}

export async function pickProjectFolder(): Promise<string | null> {
  return invoke<string | null>("project_pick_folder");
}

export async function listExtensions(): Promise<ExtensionProfile[]> {
  return invoke<ExtensionProfile[]>("extension_list");
}

export async function listExtensionUpdates(): Promise<ExtensionUpdate[]> {
  return invoke<ExtensionUpdate[]>("extension_updates");
}

export async function scanExtension(
  sourcePath: string,
): Promise<ExtensionScanResult> {
  return invoke<ExtensionScanResult>("extension_scan", { sourcePath });
}

export async function listMarketplace(query: {
  search?: string;
  page?: number;
  sort?: MarketplaceSort;
}): Promise<MarketplacePage> {
  return invoke<MarketplacePage>("marketplace_list", { query });
}

export async function installMarketplacePackage(
  packageName: string,
  version?: string,
): Promise<ExtensionProfile> {
  return invoke<ExtensionProfile>("marketplace_install", {
    packageName,
    version,
  });
}

export async function pickExtensionPath(
  directory: boolean,
): Promise<string | null> {
  return invoke<string | null>("extension_pick_path", { directory });
}

export async function saveExtension(
  draft: ExtensionDraft,
): Promise<ExtensionProfile> {
  return invoke<ExtensionProfile>("extension_save", { draft });
}

export async function setExtensionEnabled(
  id: string,
  enabled: boolean,
  approvedContentHash?: string,
): Promise<ExtensionProfile> {
  return invoke<ExtensionProfile>("extension_set_enabled", {
    id,
    enabled,
    approvedContentHash,
  });
}

export async function updateExtension(id: string): Promise<ExtensionProfile> {
  return invoke<ExtensionProfile>("extension_update", { id });
}

export async function activateExtensionVersion(
  id: string,
  contentHash: string,
): Promise<ExtensionProfile> {
  return invoke<ExtensionProfile>("extension_activate_version", {
    id,
    contentHash,
  });
}

export async function deleteExtension(id: string): Promise<void> {
  return invoke("extension_delete", { id });
}

export async function listenToAgentHost(options: {
  onMessage: (message: HostToDesktopMessage) => void;
  onLifecycle: (lifecycle: AgentHostLifecycle) => void;
  onLog: (log: AgentHostLog) => void;
}): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<HostToDesktopMessage>(HOST_MESSAGE_EVENT, (event) => {
      options.onMessage(event.payload);
    }),
    listen<AgentHostLifecycle>(HOST_LIFECYCLE_EVENT, (event) => {
      options.onLifecycle(event.payload);
    }),
    listen<AgentHostLog>(HOST_LOG_EVENT, (event) => {
      options.onLog(event.payload);
    }),
  ]);

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
