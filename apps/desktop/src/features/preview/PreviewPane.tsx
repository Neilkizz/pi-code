import { useEffect, useRef, useState } from "react";
import type { PreviewLogLine, PreviewServerState } from "@pi-desktop/protocol";
import {
  getPreviewStatus,
  listenToPreview,
  openPreviewInBrowser,
  startPreview,
  stopPreview,
} from "../../platform/tauri/bridge";
import { useI18n } from "../../i18n/I18nProvider";

interface PreviewPaneProps {
  taskId: string;
  onError: (message: string) => void;
}

const MAX_LOG_LINES = 500;

export function PreviewPane({ taskId, onError }: PreviewPaneProps) {
  const { t } = useI18n();
  const [state, setState] = useState<PreviewServerState | null>(null);
  const [logs, setLogs] = useState<PreviewLogLine[]>([]);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listenToPreview({
        onLog: (line) => {
          if (line.taskId && line.taskId !== taskId) return;
          setLogs((current) => [...current.slice(-(MAX_LOG_LINES - 1)), line]);
        },
      });
      const current = await getPreviewStatus(taskId);
      if (!disposed && current?.running) setState(current);
    })().catch((cause: unknown) => {
      if (!disposed) onError(errorMessage(cause));
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onError, taskId]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logs]);

  async function handleStart(): Promise<void> {
    setStarting(true);
    try {
      const next = await startPreview(taskId);
      setState(next);
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    } finally {
      setStarting(false);
    }
  }

  async function handleStop(): Promise<void> {
    try {
      await stopPreview(taskId);
      setState(null);
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    }
  }

  function handleOpen(): void {
    if (!state) return;
    void openPreviewInBrowser(state.url).catch((cause: unknown) =>
      onError(errorMessage(cause)),
    );
  }

  function handleClear(): void {
    setLogs([]);
  }

  return (
    <section className="preview-pane">
      <header className="preview-pane__toolbar">
        <span className="preview-pane__label">{t("Preview")}</span>
        {state ? (
          <>
            <code className="preview-pane__address" title={state.url}>
              {state.url}
            </code>
            <button
              type="button"
              className="preview-pane__button"
              onClick={handleOpen}
            >
              {t("Open in browser")}
            </button>
            <button
              type="button"
              className="preview-pane__button"
              onClick={handleStop}
            >
              {t("Stop preview")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="preview-pane__button preview-pane__button--primary"
            onClick={handleStart}
            disabled={starting}
          >
            {starting ? t("Starting") : t("Start preview")}
          </button>
        )}
        <button
          type="button"
          className="preview-pane__button"
          onClick={handleClear}
          disabled={logs.length === 0}
        >
          {t("Clear log")}
        </button>
      </header>

      <div className="preview-pane__body">
        {state ? (
          <iframe
            className="preview-pane__frame"
            src={state.url}
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={t("Preview")}
          />
        ) : (
          <div className="preview-pane__empty">
            <div className="preview-pane__empty-icon" aria-hidden="true">
              🌐
            </div>
            <p>
              {t(
                "Start a local preview server to render HTML, images, and PDFs from this task.",
              )}
            </p>
          </div>
        )}
      </div>

      <div className="preview-pane__console" aria-label={t("Preview console")}>
        <div className="preview-pane__console-head">
          <span>{t("Preview console")}</span>
          <span className="preview-pane__console-count">
            {logs.length > 0 ? `${logs.length}` : ""}
          </span>
        </div>
        <div className="preview-pane__console-lines" ref={logRef}>
          {logs.length === 0 ? (
            <div className="preview-pane__console-empty">
              {t("No requests yet.")}
            </div>
          ) : (
            logs.map((line, index) => (
              <div
                key={`${line.status}-${line.path}-${index}`}
                className={`preview-console__line ${
                  line.status >= 400 ? "preview-console__line--error" : ""
                }`}
              >
                <span className="preview-console__method">{line.method}</span>
                <span className="preview-console__path">{line.path}</span>
                <span className="preview-console__status">{line.status}</span>
                <span className="preview-console__meta">{line.mime}</span>
                <span className="preview-console__bytes">
                  {formatBytes(line.bytes)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
