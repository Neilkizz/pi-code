import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavIcon } from "../../design-system/NavIcon";
import { useI18n } from "../../i18n/I18nProvider";
import type { ActivityItem, TaskViewState } from "../sessions/types";
import { ToolEventCard } from "./ToolEventCard";

interface TimelineProps {
  hasTask: boolean;
  taskView: TaskViewState;
  taskConnected: boolean;
  taskRunning: boolean;
  taskError?: string;
  showActivity: boolean;
}

export function Timeline({
  hasTask,
  taskView,
  taskConnected,
  taskRunning,
  taskError,
  showActivity,
}: TimelineProps) {
  const { t } = useI18n();
  const endRef = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const scheduledScroll = useRef<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const lastMessage = taskView.messages.at(-1);

  function scrollToLatest(behavior: ScrollBehavior = "auto"): void {
    const container = endRef.current?.closest<HTMLElement>(".conversation");
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }

  useEffect(() => {
    const container = endRef.current?.closest<HTMLElement>(".conversation");
    if (!container) return;
    const updateFollowState = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distance < 56;
      followLatest.current = atBottom;
      setShowJumpToLatest(!atBottom);
    };
    updateFollowState();
    container.addEventListener("scroll", updateFollowState, { passive: true });
    return () => container.removeEventListener("scroll", updateFollowState);
  }, [hasTask]);

  useLayoutEffect(() => {
    if (!followLatest.current) return;
    if (scheduledScroll.current !== null) {
      cancelAnimationFrame(scheduledScroll.current);
    }
    scheduledScroll.current = requestAnimationFrame(() => {
      if (followLatest.current) {
        scrollToLatest();
      }
      scheduledScroll.current = null;
    });
    return () => {
      if (scheduledScroll.current !== null) {
        cancelAnimationFrame(scheduledScroll.current);
        scheduledScroll.current = null;
      }
    };
  }, [lastMessage?.id, lastMessage?.text, taskRunning, taskView.activities.length]);

  useEffect(() => {
    const anchor = endRef.current;
    const transcript = anchor?.closest<HTMLElement>(".transcript");
    if (!transcript || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) scrollToLatest();
    });
    observer.observe(transcript);
    return () => observer.disconnect();
  }, [hasTask]);

  function jumpToLatest(): void {
    const container = endRef.current?.closest<HTMLElement>(".conversation");
    if (!container) return;
    followLatest.current = true;
    scrollToLatest("smooth");
    setShowJumpToLatest(false);
  }

  if (!hasTask) {
    return (
      <div className="conversation-welcome">
        <span className="conversation-welcome__spark" aria-hidden="true">
          ✣
        </span>
        <h2>{t("What can Pi take off your plate?")}</h2>
        <p>
          {t(
            "Choose a project or folder, describe the outcome, and Pi will keep going until the task is done.",
          )}
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="transcript"
        aria-live="polite"
        aria-label={t("Conversation")}
      >
        {taskView.messages.map((message) => (
          <article
            className={`message message--${message.role}`}
            key={message.id}
          >
            <h2 className="sr-only">
              {message.role === "assistant" ? "Pi" : t("You")}
            </h2>
            <div className="message__body">
              <div className="message__meta" aria-hidden="true">
                {message.id === taskView.streamingAssistantId && taskError
                  ? t("Runtime error")
                  : message.role === "assistant"
                    ? "Pi"
                    : t("You")}
                {message.id === taskView.streamingAssistantId && taskRunning
                  ? ` · ${t("Working…")}`
                  : ""}
                {message.createdAt
                  ? ` · ${formatActivityTime(message.createdAt)}`
                  : ""}
              </div>
              {message.text ? (
                <div className="message__markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || "");
                        if (!inline && (match || String(children).includes("\n"))) {
                          return (
                            <CodeBlock className={className}>
                              {children}
                            </CodeBlock>
                          );
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {message.text}
                  </ReactMarkdown>
                </div>
              ) : message.id === taskView.streamingAssistantId && taskError ? (
                <div className="message__runtime-error" role="alert">
                  <strong>{t("Pi stopped before responding")}</strong>
                  <p>{taskError}</p>
                </div>
              ) : (
                <p>
                  {message.id === taskView.streamingAssistantId && taskRunning
                    ? t("Working…")
                    : ""}
                </p>
              )}
              {message.text ? (
                <div className="message__actions">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(message.text)}
                    aria-label={t("Copy")}
                    title={t("Copy")}
                  >
                    ⧉
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {taskView.messages.length === 0 ? (
          <div className="conversation-ready">
            <span>
              {taskConnected
                ? taskView.restored
                  ? t("Session restored")
                  : t("Project connected")
                : t("Connecting to Pi")}
            </span>
            <p>
              {taskConnected
                ? taskView.restored
                  ? t(
                      "Pi restored the history and context for this working branch.",
                    )
                  : t(
                      "Pi is ready to inspect the project and follow your next instruction.",
                    )
                : t("Restoring the local Pi session.")}
            </p>
          </div>
        ) : null}
        <div ref={endRef} className="timeline-end" aria-hidden="true" />
      </div>

      {showJumpToLatest ? (
        <button className="timeline-jump-latest" type="button" onClick={jumpToLatest}>
          {t("Jump to latest")}
        </button>
      ) : null}

      {showActivity && taskView.activities.length > 0 ? (
        <details className="activity-drawer" open={taskRunning || undefined}>
          <summary>
            <span>
              <NavIcon name="activity" />
              {t("Activity")}
            </span>
            <span className="activity-drawer__summary">
              {taskRunning ? t("Live") : t("Latest")}
              <b>{taskView.activities.length}</b>
            </span>
          </summary>
          <div className="activity-list">
            {taskView.activities.map((activity) => (
              <ToolEventCard activity={activity} key={activity.id} />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const textContent = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    void navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__language">{language || "code"}</span>
        <button
          type="button"
          className="code-block__copy"
          onClick={handleCopy}
          aria-label={t("Copy code")}
        >
          {copied ? t("Copied!") : t("Copy Code")}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function formatActivityTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}
