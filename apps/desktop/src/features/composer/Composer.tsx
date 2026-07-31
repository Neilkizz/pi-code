import type {
  EndpointProfile,
  RepositoryInfo,
  TaskAttachment,
  TaskIsolation,
  TaskPermissionMode,
  TaskRuntimeProfile,
} from "@pi-desktop/protocol";
import { NavIcon } from "../../design-system/NavIcon";
import { useI18n } from "../../i18n/I18nProvider";
import { deriveComposerState } from "./composerState";

interface ComposerProps {
  hasTask: boolean;
  cwd: string;
  prompt: string;
  attachments: TaskAttachment[];
  profile: TaskRuntimeProfile;
  isolation: TaskIsolation;
  repositoryInfo: RepositoryInfo | null;
  projectCheck: "idle" | "checking" | "git" | "notGit";
  projectCheckMessage: string;
  endpoints: EndpointProfile[];
  selectedEndpoint?: EndpointProfile;
  hostReady: boolean;
  taskConnected: boolean;
  taskRunning: boolean;
  isSubmitting: boolean;
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
}

export function Composer({
  hasTask,
  cwd,
  prompt,
  attachments,
  profile,
  isolation,
  repositoryInfo,
  projectCheck,
  projectCheckMessage,
  endpoints,
  selectedEndpoint,
  hostReady,
  taskConnected,
  taskRunning,
  isSubmitting,
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
}: ComposerProps) {
  const { t } = useI18n();
  const composerState = deriveComposerState({
    hasTask,
    cwd,
    prompt,
    attachments,
    isolation,
    repositoryInfo,
    projectCheck,
    hostReady,
    taskConnected,
    taskRunning,
    isSubmitting,
  });
  const submitDisabledReason = composerState.canSubmit
    ? undefined
    : composerState.blockReason === "submitting"
      ? t("Submitting prompt…")
      : composerState.blockReason === "task-restoring"
        ? t("Restoring this session…")
        : composerState.blockReason === "runtime-starting"
          ? t("Pi is still starting")
          : composerState.blockReason === "project-required"
            ? t("Select a project folder before sending")
            : composerState.blockReason === "repository-checking"
              ? t("Wait for the repository check to finish")
              : composerState.blockReason === "git-required"
                ? t("A Git repository is required for an isolated worktree")
                : t("Enter a prompt before sending");

  return (
    <div className="prompt-dock">
      <div className="composer">
        {attachments.length > 0 ? (
          <div
            className="composer-attachments"
            aria-label={t("Pending attachments")}
          >
            {attachments.map((attachment) => (
              <span
                className={`attachment-chip attachment-chip--${attachment.kind}`}
                key={attachment.id}
                title={`${attachment.name} · ${formatBytes(attachment.size)}`}
              >
                <span aria-hidden="true">
                  {attachment.kind === "image"
                    ? "▧"
                    : attachment.kind === "pdf"
                      ? "PDF"
                      : "⌘"}
                </span>
                <strong>{attachment.name}</strong>
                <small>{formatBytes(attachment.size)}</small>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment)}
                  disabled={taskRunning || isSubmitting}
                  aria-label={t("Remove {name}", { name: attachment.name })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label className="sr-only" htmlFor="task-prompt">
          {t("Prompt")}
        </label>
        <textarea
          id="task-prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              composerState.canSubmit
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={
            hasTask
              ? taskConnected
                ? t("Ask Pi to build, review, explain, or fix…")
                : t("Restoring this session…")
              : t("Describe what you want Pi to accomplish…")
          }
          rows={3}
        />
        <div className="composer__actions">
          <div className="composer__controls">
            <button
              className="composer__attach"
              type="button"
              onClick={onAttach}
              disabled={!taskConnected || taskRunning || isSubmitting}
              aria-label={t("Attach files")}
              title={`${t("Attach files")} (25 MiB)`}
            >
              +
            </button>
            <span className="composer__scope">
              {hasTask
                ? t("Local")
                : isolation === "worktree"
                  ? t("Worktree")
                  : isolation === "readOnly"
                    ? t("Read only")
                    : t("Checkout")}
            </span>
            {!hasTask ? (
              <select
                className="composer-select"
                value={profile.providerId ?? ""}
                onChange={(event) => onSelectEndpoint(event.target.value)}
                aria-label={t("API endpoint")}
              >
                <option value="">{t("Pi default")}</option>
                {endpoints.map((endpoint) => (
                  <option value={endpoint.providerId} key={endpoint.id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            ) : null}
            {selectedEndpoint ? (
              <select
                className="composer-select composer-select--model"
                value={profile.modelId ?? ""}
                onChange={(event) => onSelectModel(event.target.value)}
                disabled={hasTask}
                aria-label={t("Model")}
              >
                {selectedEndpoint.models.map((model) => (
                  <option value={model} key={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : null}
            {!hasTask ? (
              <select
                className="composer-select composer-select--permission"
                value={profile.permissionMode}
                onChange={(event) =>
                  onPermissionMode(event.target.value as TaskPermissionMode)
                }
                disabled={isolation === "readOnly"}
                aria-label={t("Permission mode")}
              >
                <option value="ask">{t("Ask permissions")}</option>
                <option value="acceptEdits">{t("Accept edits")}</option>
                <option value="plan">{t("Plan mode")}</option>
              </select>
            ) : null}
          </div>
          {taskRunning ? (
            <button
              className="composer__send composer__send--stop"
              type="button"
              onClick={onAbort}
              aria-label={t("Stop Pi")}
            >
              ■
            </button>
          ) : (
            <button
              className="composer__send"
              type="button"
              onClick={onSubmit}
              disabled={!composerState.canSubmit}
              aria-label={t("Send prompt")}
              aria-busy={isSubmitting}
              title={submitDisabledReason}
            >
              ↑
            </button>
          )}
        </div>
      </div>

      {!hasTask ? (
        <div className="project-picker">
          <div className="project-picker__path">
            <div className="project-picker__label">
              <NavIcon name="folder" />
              <span>{t("Work in a project or folder")}</span>
            </div>
            <input
              value={cwd}
              onChange={(event) => onCwdChange(event.target.value)}
              placeholder={t("Choose a local folder…")}
              aria-label={t("Project folder")}
            />
            <button
              className="button button--quiet"
              type="button"
              onClick={onChooseProject}
            >
              {t("Browse…")}
            </button>
          </div>
          <div className="project-picker__options">
            <label htmlFor="task-isolation">{t("Isolation")}</label>
            <select
              id="task-isolation"
              className="composer-select project-picker__isolation"
              value={isolation}
              onChange={(event) =>
                onIsolation(event.target.value as TaskIsolation)
              }
            >
              <option value="worktree" disabled={!repositoryInfo}>
                {t("New worktree (recommended)")}
              </option>
              <option value="currentCheckout">{t("Current checkout")}</option>
              <option value="readOnly">{t("Read-only project")}</option>
            </select>
            <span
              className={`project-picker__hint project-picker__hint--${projectCheck}`}
              title={projectCheckMessage}
            >
              {projectCheck === "checking"
                ? t("Checking repository…")
                : projectCheck === "git"
                  ? projectCheckMessage
                  : projectCheck === "notGit"
                    ? t("Not a Git repository · worktree unavailable")
                    : t("Git projects use an isolated worktree by default")}
            </span>
            <button
              className="button button--quiet project-picker__scratch"
              type="button"
              onClick={onUseScratchWorkspace}
            >
              {t("Use private scratch folder")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
