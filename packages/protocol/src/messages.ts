import type {
  DesktopCommandMetadata,
  HostMessageMetadata,
  ProtocolHello,
} from "./envelope.js";

export type DesktopShellStatus = "booting" | "ready" | "error";
export type DesktopHostStatus = "idle" | "starting" | "ready" | "error" | "stopped";
export type DesktopTaskStatus = "idle" | "running" | "waiting" | "completed" | "failed";
export type TaskPermissionMode = "ask" | "acceptEdits" | "plan" | "auto";

export interface DesktopHostState {
  status: DesktopHostStatus;
  runtime:
    | "pi-agent-host"
    | "pi-agent-coordinator"
    | "pi-agent-task-worker";
  version?: string;
  error?: string;
}

export interface DesktopTaskState {
  id: string;
  cwd: string;
  status: DesktopTaskStatus;
  profile: TaskRuntimeProfile;
  error?: string;
  warnings?: string[];
}

export interface TaskRuntimeProfile {
  providerId?: string;
  modelId?: string;
  permissionMode: TaskPermissionMode;
}

export interface PersistedTask {
  id: string;
  title: string;
  cwd: string;
  projectRoot: string;
  isolation: TaskIsolation;
  worktree?: TaskWorktree;
  profile: TaskRuntimeProfile;
  archived: boolean;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface ProjectSummary {
  id: string;
  displayName: string;
  root: string;
  trust: string;
  taskCount: number;
  lastOpenedAt: number;
  updatedAt: number;
  instructions: string;
}

export type TaskIsolation = "worktree" | "currentCheckout" | "readOnly";

export interface TaskWorktree {
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  baseline: string;
}

export interface PersistedTaskDraft {
  id?: string;
  title?: string;
  cwd: string;
  projectRoot?: string;
  isolation?: TaskIsolation;
  worktree?: TaskWorktree;
  profile: TaskRuntimeProfile;
}

export interface TaskCreateDraft {
  title?: string;
  projectPath: string;
  isolation: TaskIsolation;
  profile: TaskRuntimeProfile;
}

export interface TaskPermissionRequest {
  id: string;
  taskId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type TaskAttachmentKind = "file" | "image" | "pdf";

export interface TaskAttachment {
  id: string;
  taskId: string;
  kind: TaskAttachmentKind;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: number;
}

export interface TaskPromptAttachment {
  id: string;
  kind: TaskAttachmentKind;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface TaskBrokerRequest {
  id: string;
  taskId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  approvalId?: string;
  operation: string;
  arguments: Record<string, unknown>;
}

export interface TaskTranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
}

export interface DesktopShellSnapshot {
  status: DesktopShellStatus;
  host: DesktopHostState;
  tasks: DesktopTaskState[];
}

export interface DesktopBootstrap {
  appDataDir: string;
  storage: DesktopStorageState;
  snapshot: DesktopShellSnapshot;
}

export interface DesktopStorageState {
  schemaVersion: number;
  importedSources: number;
  importedRecords: number;
}

export interface PersistedTaskEvent {
  eventId: number;
  messageId: string;
  protocolVersion: number;
  taskId: string;
  workerId: string;
  seq: number;
  kind: string;
  timestamp: number;
  correlationId?: string;
  message: HostToDesktopMessage;
  persistedAt: number;
}

export interface PersistedTaskSnapshot {
  eventId: number;
  workerId: string;
  seq: number;
  status: DesktopTaskState;
  updatedAt: number;
}

export interface TaskEventReplay {
  snapshot?: PersistedTaskSnapshot;
  events: PersistedTaskEvent[];
  nextCursor: number;
  hasMore: boolean;
}

export interface RepositoryInfo {
  root: string;
  baseline: string;
  currentBranch?: string;
}

export interface WorktreeInfo {
  taskId: string;
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  baseline: string;
  dirty: boolean;
  changedFiles: number;
}

export type WorkspaceChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export interface WorkspaceChange {
  path: string;
  oldPath?: string;
  status: WorkspaceChangeStatus;
  staged: boolean;
  unstaged: boolean;
}

export interface WorkspaceFileEntry {
  path: string;
  size: number;
}

export interface WorkspaceSnapshot {
  taskId: string;
  root: string;
  isGit: boolean;
  branch?: string;
  head?: string;
  changes: WorkspaceChange[];
  files: WorkspaceFileEntry[];
  filesTruncated: boolean;
  generatedAt: number;
}

export interface WorkspaceFileContent {
  path: string;
  content: string;
  language: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  /** Lowercase sha256 hex of the file bytes — the editor's save-time stale guard. */
  hash: string;
  /** Hex of the first 128 bytes, present only for binary files (hex preview). */
  binaryPreview?: string;
}

export interface WorkspaceDiff {
  path?: string;
  content: string;
  truncated: boolean;
  generatedAt: number;
}

export type WorkspaceHunkOperation = "keep" | "revert";

/** One unified-diff hunk, identified by its old/new line ranges plus the verbatim
 *  hunk body (the `@@` header line and its context/added/removed lines). The body
 *  lets Keep re-apply a hunk that was previously reverted, since git apply matches
 *  against the file's current content. */
export interface WorkspaceHunkRef {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string;
}

export interface WorkspacePatchResult {
  ok: boolean;
  operation: WorkspaceHunkOperation;
  path: string;
  /** Number of hunks applied (1 for a single hunk, all for a whole-file op). */
  appliedHunks: number;
  message?: string;
}

/** Result of a user-initiated light-editor save. */
export interface WorkspaceWriteResult {
  ok: boolean;
  path: string;
  bytesWritten: number;
  /** sha256 hex of the newly written content — pass back on the next save. */
  hash: string;
}

/** Bounded results of a full-tree workspace file-name search. */
export interface WorkspaceFileSearch {
  taskId: string;
  query: string;
  files: WorkspaceFileEntry[];
  truncated: boolean;
}

export interface TerminalLaunch {
  taskId: string;
  pid: number;
  shell: string;
}

export interface TerminalOutput {
  taskId: string;
  dataBase64: string;
}

export interface TerminalExit {
  taskId: string;
  code?: number;
  signal?: number;
}

export interface PreviewServerState {
  taskId: string;
  port: number;
  url: string;
  running: boolean;
}

export interface PreviewLogLine {
  taskId: string;
  method: string;
  path: string;
  status: number;
  bytes: number;
  mime: string;
}

export interface AgentHostLaunch {
  pid: number;
  runtime: "development-node" | "bundled-node" | "existing";
  entry: string;
}

export interface AgentHostLifecycle {
  status: "spawned" | "exited";
  pid: number;
  code?: number;
}

export interface AgentHostLog {
  stream: "stdout" | "stderr" | "supervisor";
  line: string;
}

export type EndpointKind =
  | "openai-compatible"
  | "anthropic-compatible"
  | "ollama";

export interface EndpointProfile {
  id: string;
  providerId: string;
  name: string;
  kind: EndpointKind;
  baseUrl: string;
  defaultModel?: string;
  models: string[];
  enabled: boolean;
  isDefault: boolean;
  credentialRef?: string;
  createdAt: number;
  updatedAt: number;
  hasApiKey: boolean;
}

export interface EndpointDraft {
  id?: string;
  name: string;
  kind: EndpointKind;
  baseUrl: string;
  defaultModel?: string;
  models: string[];
  enabled: boolean;
  isDefault: boolean;
  apiKey?: string;
  clearApiKey: boolean;
}

export interface EndpointDiscoveryDraft {
  id?: string;
  kind: EndpointKind;
  baseUrl: string;
  apiKey?: string;
}

export interface EndpointRuntimeConfig {
  id: string;
  name: string;
  kind: EndpointKind;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface EndpointTestResult {
  reachable: boolean;
  authenticated: boolean;
  statusCode: number;
  latencyMs: number;
  models: string[];
  message: string;
}

export type ExtensionFindingSeverity = "info" | "warning" | "critical";
export type ExtensionSourceKind = "local" | "npm";
export type ExtensionIntegrityMode = "scannable-v1" | "full-tree-v1";

export interface ExtensionFinding {
  severity: ExtensionFindingSeverity;
  capability: string;
  message: string;
  file?: string;
}

export interface ExtensionProfile {
  id: string;
  name: string;
  sourcePath: string;
  sourceKind: ExtensionSourceKind;
  packageName?: string;
  packageVersion?: string;
  installPath: string;
  integrityMode: ExtensionIntegrityMode;
  enabled: boolean;
  approved: boolean;
  contentHash: string;
  activeVersion: string;
  versions: ExtensionVersion[];
  findings: ExtensionFinding[];
  scannedFiles: number;
  scannedBytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionVersion {
  contentHash: string;
  installPath: string;
  integrityMode: ExtensionIntegrityMode;
  packageVersion?: string;
  approved: boolean;
  findings: ExtensionFinding[];
  scannedFiles: number;
  scannedBytes: number;
  installedAt: number;
}

export interface ExtensionDraft {
  id?: string;
  name: string;
  sourcePath: string;
  enabled: boolean;
  approved: boolean;
  approvedContentHash?: string;
}

export interface ExtensionScanResult {
  sourcePath: string;
  contentHash: string;
  findings: ExtensionFinding[];
  scannedFiles: number;
  scannedBytes: number;
}

/**
 * Immutable, Core-verified extension snapshot made available to Pi Host.
 * Source paths are deliberately excluded: runtime code may only load the
 * quarantined installPath whose content hash was verified by Core.
 */
export interface ExtensionRuntimeConfig {
  id: string;
  name: string;
  installPath: string;
  contentHash: string;
  integrityMode: ExtensionIntegrityMode;
}

export type MarketplaceSort = "downloads" | "recent" | "name";

export interface MarketplacePackage {
  name: string;
  description: string;
  version: string;
  author: string;
  types: string[];
  downloads: number;
  publishedAt: number;
  npmUrl: string;
  repositoryUrl?: string;
  detailUrl: string;
}

export interface MarketplacePage {
  source: "pi.dev";
  packages: MarketplacePackage[];
  page: number;
  totalPages: number;
  fetchedAt: number;
}

export interface ExtensionUpdate {
  id: string;
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  error?: string;
}

export interface UpdatePreferences {
  autoUpdatePiAgent: boolean;
  autoUpdateExtensions: boolean;
}

export interface PiAgentUpdateStatus {
  bundledVersion: string;
  activeVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  restartRequired: boolean;
  preferences: UpdatePreferences;
  error?: string;
}

export interface AutomaticUpdateReport {
  piAgentUpdated?: string;
  extensionsUpdated: string[];
  errors: string[];
}

export type DesktopToHostPayload =
  | { type: "host.bootstrap"; appDataDir: string }
  | {
      type: "host.configureEndpoints";
      endpoints: EndpointRuntimeConfig[];
    }
  | {
      type: "host.configureExtensions";
      extensions: ExtensionRuntimeConfig[];
    }
  | {
      type: "task.create";
      taskId: string;
      cwd: string;
      isolation: TaskIsolation;
      profile: TaskRuntimeProfile;
      projectInstructions?: string;
      resume: boolean;
    }
  | {
      type: "task.prompt";
      taskId: string;
      prompt: string;
      attachments: TaskPromptAttachment[];
    }
  | { type: "task.abort"; taskId: string }
  | { type: "task.close"; taskId: string }
  | {
      type: "task.permission.respond";
      taskId: string;
      requestId: string;
      approved: boolean;
    }
  | {
      type: "broker.response";
      taskId: string;
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    };

export type DesktopToHostMessage = DesktopCommandMetadata &
  DesktopToHostPayload;

export interface PiSessionEvent {
  type: string;
  [key: string]: unknown;
}

export type HostToDesktopPayload =
  | {
      type: "response";
      ok: true;
      result?: unknown;
    }
  | {
      type: "response";
      ok: false;
      error: { code: string; message: string };
    }
  | {
      type: "host.hello";
      hello: ProtocolHello;
    }
  | {
      type: "host.status";
      state: DesktopHostState;
    }
  | {
      type: "task.status";
      task: DesktopTaskState;
    }
  | {
      type: "task.event";
      taskId: string;
      event: PiSessionEvent;
    }
  | {
      type: "task.history";
      taskId: string;
      messages: TaskTranscriptMessage[];
    }
  | {
      type: "task.permission.request";
      request: TaskPermissionRequest;
    }
  | {
      type: "task.broker.request";
      request: TaskBrokerRequest;
    };

export type HostToDesktopMessage = HostMessageMetadata &
  HostToDesktopPayload;
