import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PersistedTask,
  TerminalExit,
  TerminalLaunch,
} from "@pi-desktop/protocol";
import {
  listenToUserTerminal,
  resizeUserTerminal,
  startUserTerminal,
  stopUserTerminal,
  writeUserTerminal,
} from "../../platform/tauri/bridge";
import { useI18n } from "../../i18n/I18nProvider";

interface TaskTerminalProps {
  task: PersistedTask;
  onClose: () => void;
  onError: (message: string) => void;
}

const MAX_RENDERED_TERMINAL_CHARACTERS = 300_000;

export function TaskTerminal({
  task,
  onClose,
  onError,
}: TaskTerminalProps) {
  const { t } = useI18n();
  const [launch, setLaunch] = useState<TerminalLaunch | null>(null);
  const [exit, setExit] = useState<TerminalExit | null>(null);
  const [rawOutput, setRawOutput] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const decoder = useRef(new TextDecoder());
  const rendered = useMemo(() => renderTerminal(rawOutput), [rawOutput]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listenToUserTerminal({
        onOutput: (event) => {
          if (event.taskId !== task.id) return;
          const chunk = decoder.current.decode(decodeBase64(event.dataBase64), {
            stream: true,
          });
          setRawOutput((current) =>
            `${current}${chunk}`.slice(-MAX_RENDERED_TERMINAL_CHARACTERS),
          );
        },
        onExit: (event) => {
          if (event.taskId !== task.id) return;
          setExit(event);
          setLaunch(null);
        },
      });
      const started = await startUserTerminal(task.id);
      if (disposed) {
        await stopUserTerminal(task.id);
        return;
      }
      setLaunch(started);
      setExit(null);
      window.requestAnimationFrame(() => terminalRef.current?.focus());
    })().catch((cause: unknown) => {
      if (!disposed) onError(errorMessage(cause));
    });
    return () => {
      disposed = true;
      unlisten?.();
      void stopUserTerminal(task.id).catch(() => undefined);
    };
  }, [onError, task.id]);

  useEffect(() => {
    const element = terminalRef.current;
    if (!element || !launch) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? element.clientWidth;
      const height = entry?.contentRect.height ?? element.clientHeight;
      const columns = Math.max(20, Math.floor(width / 7.15));
      const rows = Math.max(4, Math.floor(height / 15.2));
      void resizeUserTerminal(task.id, columns, rows).catch((cause: unknown) =>
        onError(errorMessage(cause)),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [launch, onError, task.id]);

  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [rendered]);

  async function restart(): Promise<void> {
    try {
      await stopUserTerminal(task.id);
      setRawOutput("");
      setExit(null);
      setLaunch(await startUserTerminal(task.id));
      window.requestAnimationFrame(() => terminalRef.current?.focus());
    } catch (cause: unknown) {
      onError(errorMessage(cause));
    }
  }

  function send(data: string): void {
    if (!launch || !data) return;
    void writeUserTerminal(task.id, data).catch((cause: unknown) =>
      onError(errorMessage(cause)),
    );
  }

  return (
    <section className="task-terminal" aria-label={t("User terminal")}>
      <header>
        <div>
          <strong>{t("Terminal")}</strong>
          <span>
            {t("User PTY · separate from Agent tools")}
            {launch ? ` · PID ${launch.pid}` : ""}
          </span>
        </div>
        <div className="task-terminal__actions">
          {exit ? (
            <button type="button" onClick={() => void restart()}>
              {t("Restart")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close terminal")}
          >
            ×
          </button>
        </div>
      </header>
      <div
        className="task-terminal__screen"
        ref={terminalRef}
        tabIndex={0}
        role="textbox"
        aria-multiline="true"
        aria-label={t("Interactive zsh terminal")}
        onClick={() => terminalRef.current?.focus()}
        onPaste={(event) => {
          event.preventDefault();
          send(event.clipboardData.getData("text"));
        }}
        onKeyDown={(event) => {
          const data = terminalKey(event);
          if (data === undefined) return;
          event.preventDefault();
          send(data);
        }}
      >
        <pre ref={outputRef}>
          {rendered}
          {exit ? (
            <span className="task-terminal__exit">
              {`\n[${
                t("terminal exited")
              }${
                exit.code !== undefined
                  ? ` ${t("with code")} ${exit.code}`
                  : exit.signal !== undefined
                    ? ` ${t("on signal")} ${exit.signal}`
                    : ""
              }]\n`}
            </span>
          ) : null}
        </pre>
      </div>
    </section>
  );
}

function terminalKey(event: React.KeyboardEvent): string | undefined {
  if (event.metaKey) return undefined;
  if (event.ctrlKey && event.key.length === 1) {
    const upper = event.key.toUpperCase().charCodeAt(0);
    if (upper >= 64 && upper <= 95) {
      return String.fromCharCode(upper - 64);
    }
  }
  const special: Record<string, string> = {
    Enter: "\r",
    Backspace: "\x7f",
    Tab: "\t",
    Escape: "\x1b",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    Delete: "\x1b[3~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
  };
  if (special[event.key]) return special[event.key];
  if (event.key.length === 1) {
    return event.altKey ? `\x1b${event.key}` : event.key;
  }
  return undefined;
}

function renderTerminal(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][0-2A-Z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]*\x08/g, "");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
