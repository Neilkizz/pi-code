import { useEffect } from "react";
import type {
  DesktopHostStatus,
  DesktopTaskState,
  EndpointProfile,
  PersistedTask,
  RepositoryInfo,
  TaskAttachment,
  TaskIsolation,
  TaskPermissionMode,
  TaskPermissionRequest,
  TaskRuntimeProfile,
} from "@pi-desktop/protocol";
import { ApprovalShelf } from "../approvals/ApprovalShelf";
import { Composer } from "../composer/Composer";
import { Timeline } from "../timeline/Timeline";
import { TaskTerminal } from "../terminal/TaskTerminal";
import { WorkspaceInspector } from "../workspace/WorkspaceInspector";
import { PaneLayout } from "../workspace/PaneLayout";
import { PreviewPane } from "../preview/PreviewPane";
import {
  usePaneLayoutState,
  type LayoutPreset,
} from "../workspace/paneLayoutState";
import { useI18n } from "../../i18n/I18nProvider";
import { compactPath, permissionModeLabel } from "./presentation";
import type { QueuedPrompt, TaskViewState } from "./types";

interface SessionWorkspaceProps {
  record?: PersistedTask;
  runtimeTask?: DesktopTaskState;
  hostStatus: DesktopHostStatus;
  taskView: TaskViewState;
  permissions: TaskPermissionRequest[];
  profile: TaskRuntimeProfile;
  isolation: TaskIsolation;
  repositoryInfo: RepositoryInfo | null;
  projectCheck: "idle" | "checking" | "git" | "notGit";
  projectCheckMessage: string;
  endpoints: EndpointProfile[];
  selectedEndpoint?: EndpointProfile;
  cwd: string;
  prompt: string;
  attachments: TaskAttachment[];
  hostReady: boolean;
  taskConnected: boolean;
  taskRunning: boolean;
  isSubmitting: boolean;
  taskLoading: boolean;
  archiveConfirm: boolean;
  queuedPrompts?: QueuedPrompt[];
  onClearQueue?: () => void;
  onArchive: () => void;
  onArchiveBlur: () => void;
  onPermission: (request: TaskPermissionRequest, approved: boolean) => void;
  onCwdChange: (cwd: string) => void;
  onPromptChange: (prompt: string) => void;
  onAttach: () => void;
  onRemoveAttachment: (attachment: TaskAttachment) => void;
  onChooseProject: () => void;
  onUseScratchWorkspace: () => void;
  onSelectEndpoint: (providerId: string) => void;
  onSelectModel: (modelId: string) => void;
  onPermissionMode: (mode: TaskPermissionMode) => void;
  onIsolation: (isolation: TaskIsolation) => void;
  onSubmit: () => void;
  onAbort: () => void;
  onRequestSessionTree?: (taskId: string) => void;
  onError: (message: string) => void;
}

export function SessionWorkspace({
  record,
  runtimeTask,
  hostStatus,
  taskView,
  permissions,
  profile,
  isolation,
  repositoryInfo,
  projectCheck,
  projectCheckMessage,
  endpoints,
  selectedEndpoint,
  cwd,
  prompt,
  attachments,
  hostReady,
  taskConnected,
  taskRunning,
  isSubmitting,
  taskLoading,
  archiveConfirm,
  queuedPrompts = [],
  onClearQueue,
  onArchive,
  onArchiveBlur,
  onPermission,
  onCwdChange,
  onPromptChange,
  onAttach,
  onRemoveAttachment,
  onChooseProject,
  onUseScratchWorkspace,
  onSelectEndpoint,
  onSelectModel,
  onPermissionMode,
  onIsolation,
  onSubmit,
  onAbort,
  onRequestSessionTree,
  onError,
}: SessionWorkspaceProps) {
  const { t } = useI18n();
  const {
    config,
    selectPreset,
    toggleInspector,
    toggleTerminal,
    togglePreview,
    setSideWidth,
    setTerminalHeight,
    setPreviewHeight,
    resetLayout,
  } = usePaneLayoutState();

  const taskContext = [
    record ? compactPath(record.cwd) : t("Local environment"),
    record?.worktree?.branch,
    selectedEndpoint?.name ?? t("Pi default"),
    profile.modelId,
    t(permissionModeLabel(profile.permissionMode)),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (event.metaKey && !event.altKey && event.key.toLocaleLowerCase() === "j") {
        event.preventDefault();
        if (record) toggleTerminal();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [record, toggleTerminal]);

  const chatPane = (
    <div
      className={`conversation ${
        record ? "conversation--task" : "conversation--new"
      }`}
    >
      <Timeline
        hasTask={Boolean(record)}
        taskView={taskView}
        taskConnected={taskConnected}
        taskRunning={taskRunning}
        taskError={runtimeTask?.error}
        showActivity
      />
      <ApprovalShelf requests={permissions} onResolve={onPermission} />
      <Composer
        hasTask={Boolean(record)}
        cwd={cwd}
        prompt={prompt}
        attachments={attachments}
        profile={profile}
        isolation={isolation}
        repositoryInfo={repositoryInfo}
        projectCheck={projectCheck}
        projectCheckMessage={projectCheckMessage}
        endpoints={endpoints}
        selectedEndpoint={selectedEndpoint}
        hostReady={hostReady}
        taskConnected={taskConnected}
        taskRunning={taskRunning}
        isSubmitting={isSubmitting}
        onCwdChange={onCwdChange}
        onPromptChange={onPromptChange}
        onAttach={onAttach}
        onRemoveAttachment={onRemoveAttachment}
        onChooseProject={onChooseProject}
        onUseScratchWorkspace={onUseScratchWorkspace}
        onSelectEndpoint={onSelectEndpoint}
        onSelectModel={onSelectModel}
        onPermissionMode={onPermissionMode}
        onIsolation={onIsolation}
        onSubmit={onSubmit}
        onAbort={onAbort}
        queuedPrompts={queuedPrompts}
        onClearQueue={onClearQueue}
      />
    </div>
  );

  const inspectorPane = record ? (
    <WorkspaceInspector
      task={record}
      runtimeStatus={runtimeTask?.status}
      activities={taskView.activities}
      sessionTree={taskView.tree}
      treeLoading={taskView.treeLoading}
      onRequestTree={() => onRequestSessionTree?.(record.id)}
      onError={onError}
    />
  ) : undefined;

  const terminalPane = record ? (
    <TaskTerminal
      task={record}
      onClose={toggleTerminal}
      onError={onError}
    />
  ) : undefined;

  const previewPane = record ? (
    <PreviewPane taskId={record.id} onError={onError} />
  ) : undefined;

  return (
    <section className="session-workspace">
      <header className="session-toolbar">
        <div className="session-toolbar__title">
          <span className="session-toolbar__project">
            {record ? t("Project") : t("Local")}
          </span>
          <span className="session-toolbar__separator" aria-hidden="true">
            /
          </span>
          <strong>{record?.title ?? t("New task")}</strong>
          <span className="session-toolbar__meta" title={record?.cwd}>
            {taskContext}
          </span>
        </div>
        <div className="session-toolbar__status">
          {record ? (
            <div className="layout-preset-selector">
              <select
                className="layout-preset-select"
                value={config.preset}
                onChange={(e) => selectPreset(e.target.value as LayoutPreset)}
                aria-label={t("Layout")}
                title={t("Layout")}
              >
                <option value="chat-inspector">{t("Chat + Inspector")}</option>
                <option value="chat-terminal">{t("Chat + Terminal")}</option>
                <option value="three-pane">{t("3-Pane")}</option>
                <option value="chat-only">{t("Chat only")}</option>
                {config.preset === "custom" ? (
                  <option value="custom">{t("Custom")}</option>
                ) : null}
              </select>
              {config.preset === "custom" || config.sideWidth !== 360 || config.terminalHeight !== 240 ? (
                <button
                  className="layout-reset-button"
                  type="button"
                  onClick={resetLayout}
                  title={t("Reset layout")}
                >
                  {t("Reset")}
                </button>
              ) : null}
            </div>
          ) : null}
          {record ? (
            <button
              className={`terminal-button ${
                config.terminalOpen ? "terminal-button--active" : ""
              }`}
              type="button"
              onClick={toggleTerminal}
              aria-pressed={config.terminalOpen}
              title={t("Toggle user terminal (⌘J)")}
            >
              {t("Terminal")}
            </button>
          ) : null}
          {record ? (
            <button
              className={`review-button ${
                config.previewOpen ? "review-button--active" : ""
              }`}
              type="button"
              onClick={togglePreview}
              aria-pressed={config.previewOpen}
              title={t("Toggle preview pane")}
            >
              {t("Preview")}
            </button>
          ) : null}
          {record ? (
            <button
              className={`review-button ${
                config.inspectorOpen ? "review-button--active" : ""
              }`}
              type="button"
              onClick={toggleInspector}
              aria-pressed={config.inspectorOpen}
              title={t("Toggle project review pane")}
            >
              {t("Review")}
            </button>
          ) : null}
          {record ? (
            <button
              className={`archive-button ${
                archiveConfirm ? "archive-button--confirm" : ""
              }`}
              type="button"
              onClick={onArchive}
              onBlur={onArchiveBlur}
              disabled={taskRunning}
              title={t("Archive session metadata; Pi history is preserved")}
            >
              {archiveConfirm ? t("Archive?") : t("Archive")}
            </button>
          ) : null}
          <span className={`status-dot status-dot--${hostStatus}`} />
          <span
            className={`task-status task-status--${
              runtimeTask?.status ?? "idle"
            }`}
          >
            {record
              ? t(runtimeTask?.status ?? (taskLoading ? "connecting" : "saved"))
              : t("not started")}
          </span>
        </div>
      </header>

      <PaneLayout
        chatPane={chatPane}
        inspectorPane={inspectorPane}
        terminalPane={terminalPane}
        previewPane={previewPane}
        config={config}
        hasRecord={Boolean(record)}
        onSideWidthChange={setSideWidth}
        onTerminalHeightChange={setTerminalHeight}
        onPreviewHeightChange={setPreviewHeight}
        onResetSideWidth={resetLayout}
        onResetTerminalHeight={resetLayout}
        onResetPreviewHeight={resetLayout}
      />
    </section>
  );
}
