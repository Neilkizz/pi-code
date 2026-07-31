import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopTaskStatus,
  PersistedTask,
  WorkspaceDiff,
  WorkspaceFileContent,
  WorkspaceHunkOperation,
  WorkspaceSnapshot,
} from "@pi-desktop/protocol";
import {
  applyWorkspacePatch,
  getWorkspaceSnapshot,
  readWorkspaceDiff,
  readWorkspaceFile,
} from "../../platform/tauri/bridge";
import { useI18n } from "../../i18n/I18nProvider";
import type { ActivityItem } from "../sessions/types";
import { parseUnifiedDiff, type ParsedDiffHunk } from "./parseUnifiedDiff";

type InspectorTab = "changes" | "files" | "steps" | "security";
type Preview =
  | { kind: "diff"; value: WorkspaceDiff }
  | { kind: "file"; value: WorkspaceFileContent };

interface WorkspaceInspectorProps {
  task: PersistedTask;
  runtimeStatus?: DesktopTaskStatus;
  activities: ActivityItem[];
  onError: (message: string) => void;
}

const changeLabels: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  conflicted: "!",
};

export function WorkspaceInspector({
  task,
  runtimeStatus,
  activities,
  onError,
}: WorkspaceInspectorProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("changes");
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);

  // Hunks the user reverted this session (keyed by path), so each can be re-kept.
  const [revertedByPath, setRevertedByPath] = useState<
    Record<string, ParsedDiffHunk[]>
  >({});
  // Busy marker while an apply is in flight: `hunk:<path>:<oldStart>` or `file:<path>`.
  const [applying, setApplying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await getWorkspaceSnapshot(task.id);
      if (sequence === requestSequence.current) {
        setSnapshot(next);
      }
    } catch (cause: unknown) {
      if (sequence === requestSequence.current) {
        onError(errorMessage(cause));
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
      }
    }
  }, [onError, task.id]);

  useEffect(() => {
    setSnapshot(null);
    setPreview(null);
    setFilter("");
    setRevertedByPath({});
    void refresh();
  }, [refresh, task.id]);

  useEffect(() => {
    if (runtimeStatus !== "running" && runtimeStatus !== "waiting") {
      void refresh();
      return;
    }
    const interval = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(interval);
  }, [refresh, runtimeStatus]);

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const files = useMemo(
    () =>
      (snapshot?.files ?? []).filter((file) =>
        normalizedFilter
          ? file.path.toLocaleLowerCase().includes(normalizedFilter)
          : true,
      ),
    [normalizedFilter, snapshot?.files],
  );
  const changes = useMemo(
    () =>
      (snapshot?.changes ?? []).filter((change) =>
        normalizedFilter
          ? change.path.toLocaleLowerCase().includes(normalizedFilter)
          : true,
      ),
    [normalizedFilter, snapshot?.changes],
  );

  const toolActivities = useMemo(
    () =>
      activities.filter(
        (act) =>
          act.kind === "tool" || act.kind === "error" || act.kind === "system",
      ),
    [activities],
  );

  const securityLogs = useMemo(
    () =>
      activities.filter(
        (act) =>
          act.kind === "error" ||
          act.title.toLowerCase().includes("permission") ||
          act.title.toLowerCase().includes("approval") ||
          act.title.toLowerCase().includes("denied"),
      ),
    [activities],
  );

  async function loadDiff(relativePath?: string): Promise<void> {
    setLoading(true);
    try {
      setPreview({
        kind: "diff",
        value: await readWorkspaceDiff(task.id, relativePath),
      });
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  function openDiff(relativePath?: string): void {
    void loadDiff(relativePath);
  }

  async function openFile(relativePath: string): Promise<void> {
    setLoading(true);
    try {
      setPreview({
        kind: "file",
        value: await readWorkspaceFile(task.id, relativePath),
      });
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function applyHunk(
    operation: WorkspaceHunkOperation,
    relativePath: string,
    hunk: ParsedDiffHunk,
  ): Promise<void> {
    const marker = `hunk:${relativePath}:${hunk.oldStart}`;
    setApplying(marker);
    try {
      await applyWorkspacePatch(task.id, relativePath, operation, hunk);
      setRevertedByPath((previous) => {
        const current = previous[relativePath] ?? [];
        const updated =
          operation === "revert"
            ? [...current, hunk]
            : current.filter(
                (candidate) =>
                  candidate.oldStart !== hunk.oldStart ||
                  candidate.newStart !== hunk.newStart,
              );
        return { ...previous, [relativePath]: updated };
      });
      await loadDiff(relativePath);
      await refresh();
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    } finally {
      setApplying(null);
    }
  }

  async function applyFile(
    operation: WorkspaceHunkOperation,
    relativePath: string,
  ): Promise<void> {
    const marker = `file:${relativePath}`;
    setApplying(marker);
    try {
      await applyWorkspacePatch(task.id, relativePath, operation);
      setRevertedByPath((previous) => ({ ...previous, [relativePath]: [] }));
      await loadDiff(relativePath);
      await refresh();
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    } finally {
      setApplying(null);
    }
  }

  const previewStatus = useMemo(() => {
    const path = preview?.kind === "diff" ? preview.value.path : undefined;
    if (!path || !snapshot) return undefined;
    return snapshot.changes.find((change) => change.path === path)?.status;
  }, [preview, snapshot]);

  const activePath = preview?.value.path;

  return (
    <aside className="workspace-inspector" aria-label={t("Project inspector")}>
      <header className="workspace-inspector__header">
        <div>
          <strong>{t("Project")}</strong>
          <span>
            {snapshot?.branch ??
              (snapshot?.isGit ? t("detached HEAD") : t("Local files"))}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title={t("Refresh project")}
          aria-label={t("Refresh project")}
        >
          {loading ? "…" : "↻"}
        </button>
      </header>

      <div className="workspace-inspector__tabs" role="tablist">
        <button
          className={tab === "changes" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={tab === "changes"}
          onClick={() => setTab("changes")}
        >
          {t("Diff Viewer")}
          <span>{snapshot?.changes.length ?? 0}</span>
        </button>
        <button
          className={tab === "files" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={tab === "files"}
          onClick={() => setTab("files")}
        >
          {t("Files")}
          <span>{snapshot?.files.length ?? 0}</span>
        </button>
        <button
          className={tab === "steps" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={tab === "steps"}
          onClick={() => setTab("steps")}
        >
          {t("Agent Steps")}
          <span>{toolActivities.length}</span>
        </button>
        <button
          className={tab === "security" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={tab === "security"}
          onClick={() => setTab("security")}
        >
          {t("Security Audit")}
          <span>{securityLogs.length}</span>
        </button>
      </div>

      <div className="workspace-inspector__browser">
        {tab === "changes" || tab === "files" ? (
          <label className="workspace-search">
            <span className="sr-only">{t("Filter project paths")}</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("Filter paths")}
            />
          </label>
        ) : null}

        <div className="workspace-path-list">
          {tab === "changes" ? (
            <>
              {changes.length > 1 ? (
                <button
                  className={
                    !activePath && preview?.kind === "diff" ? "is-active" : ""
                  }
                  type="button"
                  onClick={() => openDiff()}
                >
                  <span className="change-badge change-badge--all">Σ</span>
                  <span>{t("All changes")}</span>
                </button>
              ) : null}
              {changes.map((change) => (
                <button
                  className={activePath === change.path ? "is-active" : ""}
                  type="button"
                  onClick={() => openDiff(change.path)}
                  key={`${change.status}:${change.path}`}
                  title={
                    change.oldPath
                      ? `${change.oldPath} → ${change.path}`
                      : change.path
                  }
                >
                  <span
                    className={`change-badge change-badge--${change.status}`}
                  >
                    {changeLabels[change.status] ?? "·"}
                  </span>
                  <span>{change.path}</span>
                  <small>
                    {change.staged && change.unstaged
                      ? t("index + worktree")
                      : change.staged
                        ? t("staged")
                        : t("working tree")}
                  </small>
                </button>
              ))}
              {!loading && changes.length === 0 ? (
                <div className="workspace-path-list__empty">
                  <strong>{t("Working tree clean")}</strong>
                  <span>
                    {t("Pi file changes will appear here as they happen.")}
                  </span>
                </div>
              ) : null}
            </>
          ) : tab === "files" ? (
            <>
              {files.slice(0, 1_000).map((file) => (
                <button
                  className={activePath === file.path ? "is-active" : ""}
                  type="button"
                  onClick={() => void openFile(file.path)}
                  key={file.path}
                  title={file.path}
                >
                  <span className="file-glyph">·</span>
                  <span>{file.path}</span>
                  <small>{formatBytes(file.size)}</small>
                </button>
              ))}
              {snapshot?.filesTruncated || files.length > 1_000 ? (
                <div className="workspace-path-list__notice">
                  {t(
                    "The list is limited; use the filter above to narrow it down.",
                  )}
                </div>
              ) : null}
            </>
          ) : tab === "steps" ? (
            <div className="inspector-activity-list">
              {toolActivities.map((act) => (
                <div
                  className={`activity-step activity-step--${act.kind}`}
                  key={act.id}
                >
                  <div className="activity-step__header">
                    <strong>{act.title}</strong>
                    <span className="activity-step__status">
                      {act.status ?? act.kind}
                    </span>
                  </div>
                  {act.detail ? (
                    <p className="activity-step__detail">{act.detail}</p>
                  ) : null}
                  {act.input ? (
                    <pre className="activity-step__code">{act.input}</pre>
                  ) : null}
                </div>
              ))}
              {toolActivities.length === 0 ? (
                <p className="workspace-path-list__empty">
                  {t("No step activity yet.")}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="inspector-activity-list">
              {securityLogs.map((log) => (
                <div
                  className={`security-log security-log--${log.kind}`}
                  key={log.id}
                >
                  <div className="security-log__header">
                    <span className="security-log__badge">AUDIT</span>
                    <strong>{log.title}</strong>
                  </div>
                  {log.detail ? (
                    <p className="security-log__detail">{log.detail}</p>
                  ) : null}
                </div>
              ))}
              {securityLogs.length === 0 ? (
                <div className="workspace-path-list__empty">
                  <strong>{t("Security clean")}</strong>
                  <span>
                    {t("No security alerts or denied permission requests.")}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <section className="workspace-preview">
        {tab === "steps" || tab === "security" ? null : preview ? (
          <>
            <header>
              <div>
                <strong>{preview.value.path ?? t("All changes")}</strong>
                <span>
                  {preview.kind === "diff"
                    ? t("Unified diff · read only")
                    : `${preview.value.language} · ${formatBytes(preview.value.size)}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label={t("Close preview")}
              >
                ×
              </button>
            </header>
            {preview.kind === "diff" ? (
              <DiffContent
                diff={preview.value}
                status={previewStatus}
                applying={applying}
                reverted={
                  preview.value.path
                    ? (revertedByPath[preview.value.path] ?? [])
                    : []
                }
                onApplyHunk={(operation, hunk) =>
                  preview.value.path
                    ? void applyHunk(operation, preview.value.path, hunk)
                    : undefined
                }
                onApplyFile={(operation) =>
                  preview.value.path
                    ? void applyFile(operation, preview.value.path)
                    : undefined
                }
              />
            ) : (
              <FileContent file={preview.value} />
            )}
          </>
        ) : (
          <div className="workspace-preview__empty">
            <span>{tab === "changes" ? "Δ" : "⌘"}</span>
            <strong>
              {tab === "changes"
                ? t("Review a change")
                : t("Preview a file")}
            </strong>
            <p>{t("Select a changed file or project file to preview it.")}</p>
          </div>
        )}
      </section>
    </aside>
  );
}

interface DiffContentProps {
  diff: WorkspaceDiff;
  status?: string;
  applying: string | null;
  reverted: ParsedDiffHunk[];
  onApplyHunk: (operation: WorkspaceHunkOperation, hunk: ParsedDiffHunk) => void;
  onApplyFile: (operation: WorkspaceHunkOperation) => void;
}

function DiffContent({
  diff,
  status,
  applying,
  reverted,
  onApplyHunk,
  onApplyFile,
}: DiffContentProps) {
  const { t } = useI18n();
  const [confirmRevert, setConfirmRevert] = useState(false);

  if (!diff.content.trim()) {
    return (
      <div className="workspace-preview__empty workspace-preview__empty--compact">
        <strong>{t("No textual diff")}</strong>
        <p>
          {t(
            "The file may be unchanged or contain binary content that cannot be shown inline.",
          )}
        </p>
      </div>
    );
  }

  const path = diff.path;
  // Per-hunk actions require a single-file diff; the aggregate "All changes" view
  // (no path) stays read-only to avoid mixing hunks from different files.
  const singleFile = Boolean(path);
  const hunks = parseUnifiedDiff(diff.content);
  const isUntracked = status === "untracked";
  const busy = applying !== null;
  const fileBusy = Boolean(path) && applying === `file:${path}`;

  const requestFileAction = (operation: WorkspaceHunkOperation) => {
    if (confirmRevert) {
      setConfirmRevert(false);
      onApplyFile(operation);
    } else {
      setConfirmRevert(true);
    }
  };

  return (
    <div className="diff-review">
      {singleFile ? (
        <header className="diff-review__filebar">
          <div>
            <strong>{isUntracked ? t("Untracked file") : t("Diff")}</strong>
            <span>
              {isUntracked
                ? t("Delete to remove, or keep as part of this task.")
                : t("Review each hunk, then revert what should not change.")}
            </span>
          </div>
          <div className="diff-review__fileactions">
            {isUntracked ? (
              <>
                <button
                  type="button"
                  onClick={() => onApplyFile("keep")}
                  disabled={busy}
                >
                  {fileBusy ? t("Applying…") : t("Keep file")}
                </button>
                <button
                  type="button"
                  className="diff-review__danger"
                  onClick={() => requestFileAction("revert")}
                  disabled={busy}
                >
                  {fileBusy
                    ? t("Applying…")
                    : confirmRevert
                      ? `${t("Revert file")}?`
                      : t("Delete file")}
                </button>
              </>
            ) : hunks.length > 0 ? (
              <button
                type="button"
                className="diff-review__danger"
                onClick={() => requestFileAction("revert")}
                disabled={busy}
              >
                {fileBusy
                  ? t("Applying…")
                  : confirmRevert
                    ? `${t("Revert file")}?`
                    : t("Revert file")}
              </button>
            ) : null}
          </div>
        </header>
      ) : (
        <p className="diff-review__hint">
          {t("Select a changed file to review and revert individual hunks.")}
        </p>
      )}

      {singleFile
        ? hunks.map((hunk) => (
            <HunkBlock
              key={hunk.oldStart}
              hunk={hunk}
              reverted={false}
              applying={applying === `hunk:${path}:${hunk.oldStart}`}
              actionLabel={t("Revert")}
              onAction={() => onApplyHunk("revert", hunk)}
            />
          ))
        : null}

      {singleFile
        ? reverted.map((hunk) => (
            <HunkBlock
              key={`reverted-${hunk.oldStart}`}
              hunk={hunk}
              reverted
              applying={applying === `hunk:${path}:${hunk.oldStart}`}
              actionLabel={t("Keep")}
              onAction={() => onApplyHunk("keep", hunk)}
            />
          ))
        : null}

      {singleFile && hunks.length === 0 && reverted.length === 0 ? (
        <div className="workspace-preview__empty workspace-preview__empty--compact">
          <strong>{t("No textual diff")}</strong>
          <p>
            {t(
              "The file may be unchanged or contain binary content that cannot be shown inline.",
            )}
          </p>
        </div>
      ) : null}

      {diff.truncated ? (
        <div className="code-view__limit">
          {t(
            "Large diff truncated; the complete content remains in the Git working tree.",
          )}
        </div>
      ) : null}
    </div>
  );
}

interface HunkBlockProps {
  hunk: ParsedDiffHunk;
  reverted: boolean;
  applying: boolean;
  actionLabel: string;
  onAction: () => void;
}

function HunkBlock({
  hunk,
  reverted,
  applying,
  actionLabel,
  onAction,
}: HunkBlockProps) {
  return (
    <section
      className={`diff-hunk${reverted ? " diff-hunk--reverted" : ""}`}
    >
      <header className="diff-hunk__bar">
        <code className="diff-hunk__header">{hunk.header}</code>
        <button
          type="button"
          className={reverted ? "diff-review__primary" : "diff-review__danger"}
          onClick={onAction}
          disabled={applying}
        >
          {applying ? "…" : actionLabel}
        </button>
      </header>
      <div className="code-view code-view--diff" role="region" aria-label={actionLabel}>
        {hunk.lines.map((line, index) => (
          <div
            className={`diff-line diff-line--${lineClass(line.prefix)}`}
            key={index}
          >
            <span>{line.prefix}</span>
            <code>{line.content || " "}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function lineClass(prefix: "+" | "-" | " "): "added" | "deleted" | "context" {
  if (prefix === "+") return "added";
  if (prefix === "-") return "deleted";
  return "context";
}

function FileContent({ file }: { file: WorkspaceFileContent }) {
  const { t } = useI18n();
  if (file.binary) {
    return (
      <div className="workspace-preview__empty workspace-preview__empty--compact">
        <strong>{t("Binary file")}</strong>
        <p>
          {t(
            "Only metadata is shown; binary content is not rendered as text.",
          )}
        </p>
      </div>
    );
  }
  const allLines = file.content.split("\n");
  const lines = allLines.slice(0, 5_000);
  return (
    <div className="code-view" role="region" aria-label={t("File preview")}>
      {lines.map((line, index) => (
        <div key={`${index}:${line.slice(0, 24)}`}>
          <span>{index + 1}</span>
          <code>{line || " "}</code>
        </div>
      ))}
      {file.truncated || allLines.length > lines.length ? (
        <div className="code-view__limit">
          {t("Large file truncated; preview limit is 1 MiB / 5,000 lines.")}
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
