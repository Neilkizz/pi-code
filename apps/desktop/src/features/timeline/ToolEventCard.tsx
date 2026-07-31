import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { ActivityItem } from "../sessions/types";

interface ToolEventCardProps {
  activity: ActivityItem;
}

export function ToolEventCard({ activity }: ToolEventCardProps) {
  const { t } = useI18n();
  const status = activity.status;
  const isRunning = status === "running";
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);

  return (
    <article
      className={`activity activity--${activity.kind}${
        status ? ` activity--${status}` : ""
      }${isRunning ? " activity--pulse" : ""}`}
    >
      <header className="activity__header">
        <span className={`activity__status ${isRunning ? "activity__status--running" : ""}`}>
          {isRunning
            ? t("Running…")
            : status === "failed"
              ? t("Failed")
              : status === "completed"
                ? t("Completed")
                : t("Event")}
        </span>
        <time dateTime={new Date(activity.createdAt).toISOString()}>
          {formatActivityTime(activity.createdAt)}
        </time>
      </header>
      <strong>{activity.title}</strong>
      {activity.detail ? <p>{activity.detail}</p> : null}

      {activity.input ? (
        <details
          className="activity__payload"
          open={inputOpen}
          onToggle={(e) => setInputOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>{t("Input")}</summary>
          <pre>{activity.input}</pre>
        </details>
      ) : null}

      {activity.output ? (
        <details
          className="activity__payload"
          open={outputOpen}
          onToggle={(e) => setOutputOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>{t("Output")}</summary>
          <pre>{activity.output}</pre>
        </details>
      ) : null}
    </article>
  );
}

function formatActivityTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}
