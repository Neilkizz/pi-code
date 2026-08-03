import type {
  EndpointProfile,
  RepositoryInfo,
  TaskAttachment,
  TaskIsolation,
  TaskPermissionMode,
  TaskRuntimeProfile,
} from "@pi-desktop/protocol";
import { useEffect, useRef, useState } from "react";
import { NavIcon } from "../../design-system/NavIcon";
import { useI18n } from "../../i18n/I18nProvider";
import type { QueuedPrompt } from "../sessions/types";
import { deriveComposerState } from "./composerState";
import { MentionsAutocomplete, type MentionCandidate } from "./MentionsAutocomplete";

const DEFAULT_CANDIDATES: MentionCandidate[] = [
  { id: "1", name: "App.tsx", path: "src/App.tsx", kind: "file" },
  { id: "2", name: "Composer.tsx", path: "src/features/composer/Composer.tsx", kind: "file" },
  { id: "3", name: "Timeline.tsx", path: "src/features/timeline/Timeline.tsx", kind: "file" },
  { id: "4", name: "package.json", path: "package.json", kind: "file" },
  { id: "5", name: "styles.css", path: "src/styles.css", kind: "file" },
];

export interface ComposerProps {
  hasTask?: boolean;
  cwd?: string;
  prompt?: string;
  draft?: string;
  attachments?: TaskAttachment[];
  profile?: TaskRuntimeProfile;
  isolation?: TaskIsolation;
  repositoryInfo?: RepositoryInfo | null;
  projectCheck?: "idle" | "checking" | "git" | "notGit";
  projectCheckMessage?: string;
  endpoints?: EndpointProfile[];
  selectedEndpoint?: EndpointProfile;
  hostReady?: boolean;
  isHostConnected?: boolean;
  taskConnected?: boolean;
  isSessionReady?: boolean;
  taskRunning?: boolean;
  isRunning?: boolean;
  isSubmitting?: boolean;
  queuedPrompts?: QueuedPrompt[];
  candidates?: MentionCandidate[];
  onCwdChange?: (cwd: string) => void;
  onPromptChange?: (prompt: string) => void;
  onDraftChange?: (draft: string) => void;
  onAttach?: () => void;
  onRemoveAttachment?: (attachment: TaskAttachment) => void;
  onChooseProject?: () => void;
  onUseScratchWorkspace?: () => void;
  onSelectEndpoint?: (providerId: string) => void;
  onSelectModel?: (modelId: string) => void;
  onPermissionMode?: (mode: TaskPermissionMode) => void;
  onIsolation?: (isolation: TaskIsolation) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onClearQueue?: () => void;
}

export function Composer({
  hasTask = false,
  cwd = "",
  prompt,
  draft,
  attachments = [],
  profile = { permissionMode: "ask" },
  isolation = "worktree",
  repositoryInfo = null,
  projectCheck = "idle",
  projectCheckMessage = "",
  endpoints = [],
  selectedEndpoint,
  hostReady = true,
  isHostConnected,
  taskConnected = true,
  isSessionReady,
  taskRunning = false,
  isRunning,
  isSubmitting = false,
  queuedPrompts = [],
  candidates = DEFAULT_CANDIDATES,
  onCwdChange,
  onPromptChange,
  onDraftChange,
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
  onClearQueue,
}: ComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const actualPrompt = prompt ?? draft ?? "";
  const actualHostReady = isHostConnected ?? hostReady;
  const actualTaskConnected = isSessionReady ?? taskConnected;
  const actualTaskRunning = isRunning ?? taskRunning;

  const handlePromptChange = (val: string) => {
    if (onPromptChange) onPromptChange(val);
    if (onDraftChange) onDraftChange(val);
  };

  // Mention State
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCandidates = candidates.filter((item) =>
    item.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
    (item.path && item.path.toLowerCase().includes(mentionQuery.toLowerCase()))
  );

  // Auto-expand textarea height up to 200px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const targetHeight = Math.min(Math.max(scrollHeight, 72), 200);
      textareaRef.current.style.height = `${targetHeight}px`;
    }
  }, [actualPrompt]);

  const composerState = deriveComposerState({
    hasTask,
    cwd,
    prompt: actualPrompt,
    attachments,
    isolation,
    repositoryInfo,
    projectCheck,
    hostReady: actualHostReady,
    taskConnected: actualTaskConnected,
    taskRunning: actualTaskRunning,
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

  const updateMentionState = (text: string, cursorPos: number) => {
    const textBeforeCursor = text.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([\w./-]*)$/);
    if (match) {
      setIsMentionOpen(true);
      setMentionQuery(match[1]);
      setSelectedIndex(0);
    } else {
      setIsMentionOpen(false);
      setMentionQuery("");
    }
  };

  const handleSelectMention = (candidate: MentionCandidate) => {
    if (!textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart || actualPrompt.length;
    const textBeforeCursor = actualPrompt.slice(0, cursorPos);
    const textAfterCursor = actualPrompt.slice(cursorPos);
    const newTextBefore = textBeforeCursor.replace(/@([\w./-]*)$/, `@${candidate.name} `);
    const updated = newTextBefore + textAfterCursor;
    handlePromptChange(updated);
    setIsMentionOpen(false);
    setMentionQuery("");
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = newTextBefore.length;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  return (
    <div className="prompt-dock">
      <div className="composer glassmorphism">
        {isMentionOpen ? (
          <MentionsAutocomplete
            query={mentionQuery}
            candidates={candidates}
            selectedIndex={selectedIndex}
            onSelect={handleSelectMention}
          />
        ) : null}

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
                  onClick={() => onRemoveAttachment?.(attachment)}
                  disabled={actualTaskRunning || isSubmitting}
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
          ref={textareaRef}
          id="task-prompt"
          value={actualPrompt}
          onChange={(event) => {
            handlePromptChange(event.target.value);
            updateMentionState(event.target.value, event.target.selectionStart);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              updateMentionState(actualPrompt, (event.target as HTMLTextAreaElement).selectionStart);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "@") {
              setIsMentionOpen(true);
              setMentionQuery("");
              setSelectedIndex(0);
              return;
            }

            if (isMentionOpen && filteredCandidates.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % filteredCandidates.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const selected = filteredCandidates[selectedIndex];
                if (selected) {
                  handleSelectMention(selected);
                }
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setIsMentionOpen(false);
                return;
              }
            }

            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !composingRef.current
            ) {
              if (composerState.canSubmit && onSubmit) {
                event.preventDefault();
                onSubmit();
              } else if (!composerState.canSubmit) {
                event.preventDefault();
              }
            }
          }}
          placeholder={
            hasTask
              ? actualTaskConnected
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
              disabled={!actualTaskConnected || actualTaskRunning || isSubmitting}
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
                onChange={(event) => onSelectEndpoint?.(event.target.value)}
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
                onChange={(event) => onSelectModel?.(event.target.value)}
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
                  onPermissionMode?.(event.target.value as TaskPermissionMode)
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
          {actualTaskRunning ? (
            <>
              <button
                className="composer__send"
                type="button"
                onClick={onSubmit}
                disabled={!composerState.canSubmit}
                aria-label={t("Send follow-up")}
                aria-busy={isSubmitting}
                title={t("Send follow-up")}
              >
                <NavIcon name="arrow-up" />
              </button>
              <button
                className="composer__send composer__send--stop"
                type="button"
                onClick={onAbort}
                aria-label={t("Stop Pi")}
                title={t("Stop Pi")}
              >
                <NavIcon name="stop" />
              </button>
            </>
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
              <NavIcon name="arrow-up" />
            </button>
          )}
          {hasTask && queuedPrompts.length > 0 ? (
            <div className="composer__queue">
              <button
                className="composer__queue-badge"
                type="button"
                onClick={() => setQueueOpen((current) => !current)}
                aria-expanded={queueOpen}
                aria-label={t("{count} follow-ups pending", {
                  count: queuedPrompts.length,
                })}
              >
                {queuedPrompts.length}
                <span>{t("pending")}</span>
              </button>
              {queueOpen ? (
                <div className="composer__queue-popover">
                  <div className="composer__queue-list">
                    {queuedPrompts.map((queued) => (
                      <div className="composer__queue-item" key={queued.id}>
                        {queued.text}
                      </div>
                    ))}
                  </div>
                  <button
                    className="composer__queue-clear"
                    type="button"
                    onClick={onClearQueue}
                  >
                    {t("Cancel all")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
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
              onChange={(event) => onCwdChange?.(event.target.value)}
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
                onIsolation?.(event.target.value as TaskIsolation)
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
