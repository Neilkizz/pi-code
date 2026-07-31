import { useState } from "react";
import type {
  AgentHostLaunch,
  DesktopHostState,
  DesktopTaskState,
  PersistedTask,
} from "@pi-desktop/protocol";
import type { WorkspaceView } from "../../app/routes";
import { NavIcon } from "../../design-system/NavIcon";
import { useI18n } from "../../i18n/I18nProvider";
import { compactPath, filterTasks } from "./presentation";

interface SessionSidebarProps {
  activeView: WorkspaceView;
  activeTaskId: string | null;
  tasks: PersistedTask[];
  runtimeTasks: DesktopTaskState[];
  host: DesktopHostState;
  hostLaunch: AgentHostLaunch | null;
  onViewChange: (view: WorkspaceView) => void;
  onNewTask: () => void;
  onSelectTask: (task: PersistedTask) => void;
  onRestartHost: () => void;
  onOpenCommandPalette: () => void;
}

interface TaskGroup {
  label: string;
  tasks: PersistedTask[];
}

function clusterTasksByTime(tasks: PersistedTask[], t: (key: string) => string): TaskGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfSevenDays = startOfToday - 6 * 86400000;

  const today: PersistedTask[] = [];
  const yesterday: PersistedTask[] = [];
  const previousSevenDays: PersistedTask[] = [];
  const older: PersistedTask[] = [];

  for (const task of tasks) {
    const timestamp = task.lastOpenedAt || task.updatedAt || 0;
    if (timestamp >= startOfToday) {
      today.push(task);
    } else if (timestamp >= startOfYesterday) {
      yesterday.push(task);
    } else if (timestamp >= startOfSevenDays) {
      previousSevenDays.push(task);
    } else {
      older.push(task);
    }
  }

  const groups: TaskGroup[] = [
    { label: t("Today"), tasks: today },
    { label: t("Yesterday"), tasks: yesterday },
    { label: t("Previous 7 Days"), tasks: previousSevenDays },
    { label: t("Older"), tasks: older },
  ];

  return groups.filter((group) => group.tasks.length > 0);
}

export function SessionSidebar({
  activeView,
  activeTaskId,
  tasks,
  runtimeTasks,
  host,
  hostLaunch,
  onViewChange,
  onNewTask,
  onSelectTask,
  onRestartHost,
  onOpenCommandPalette,
}: SessionSidebarProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const visibleTasks = filterTasks(tasks, query);
  const taskGroups = clusterTasksByTime(visibleTasks, t);

  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__chrome">
        <span className="brand-mark" aria-hidden="true">
          π
        </span>
        <div className="sidebar__chrome-actions">
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}
            title={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}
          >
            {collapsed ? "›" : "‹"}
          </button>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label={t("Search")}
            title={`${t("Search or run a command")} · ⌘K`}
          >
            ⌕
          </button>
        </div>
      </div>

      <div className="sidebar__mode" aria-label={t("Workspace")}>
        <button
          className={activeView === "tasks" ? "is-active" : ""}
          type="button"
          onClick={() => onViewChange("tasks")}
        >
          <NavIcon name="chat" />
          <span>{t("Agent")}</span>
        </button>
        <button
          className={activeView === "settings" ? "is-active" : ""}
          type="button"
          onClick={() => onViewChange("settings")}
        >
          <NavIcon name="sliders" />
          <span>{t("Configure")}</span>
        </button>
      </div>

      <nav className="sidebar__nav" aria-label={t("Workspace")}>
        <button
          className="nav-item nav-item--new"
          type="button"
          onClick={onNewTask}
        >
          <span className="nav-item__plus" aria-hidden="true">
            +
          </span>
          <span>{t("New Chat")}</span>
        </button>
        <button
          className={`nav-item ${
            activeView === "projects" ? "nav-item--active" : ""
          }`}
          type="button"
          onClick={() => onViewChange("projects")}
          aria-current={activeView === "projects" ? "page" : undefined}
        >
          <NavIcon name="folder" />
          <span>{t("Projects")}</span>
        </button>
      </nav>

      <section className="sidebar__sessions">
        <div className="sidebar__sessions-title">
          <span>{t("Recents")}</span>
          <button
            type="button"
            aria-label={t("New Chat")}
            title={t("New Chat")}
            onClick={onNewTask}
          >
            +
          </button>
        </div>
        <label className="sr-only" htmlFor="recent-task-search">
          {t("Search tasks")}
        </label>
        <input
          id="recent-task-search"
          className="sidebar__task-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search tasks")}
        />
        <div className="session-list">
          {taskGroups.map((group) => (
            <div className="session-group" key={group.label}>
              <div className="session-group__label">{group.label}</div>
              {group.tasks.map((task) => {
                const runtime = runtimeTasks.find(
                  (candidate) => candidate.id === task.id,
                );
                const active = activeView === "tasks" && activeTaskId === task.id;
                return (
                  <button
                    className={`session-link ${
                      active ? "session-link--active" : ""
                    }`}
                    type="button"
                    onClick={() => onSelectTask(task)}
                    aria-pressed={active}
                    key={task.id}
                  >
                    <span
                      className={`session-link__dot session-link__dot--${
                        runtime?.status ?? "saved"
                      }`}
                    />
                    <span>
                      <strong>{task.title}</strong>
                      <small title={task.cwd}>{compactPath(task.cwd)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {tasks.length === 0 ? (
            <button
              className="session-link session-link--active"
              type="button"
              onClick={onNewTask}
            >
              <span className="session-link__dot session-link__dot--saved" />
              <span>
                <strong>{t("New local task")}</strong>
                <small>{t("Choose a project folder")}</small>
              </span>
            </button>
          ) : visibleTasks.length === 0 ? (
            <p className="session-list__empty">{t("No matching tasks")}</p>
          ) : null}
        </div>
      </section>

      <div className="sidebar__section sidebar__section--runtime">
        <button
          className="runtime-summary"
          type="button"
          onClick={() => onViewChange("settings")}
          title={t("Open settings")}
        >
          <span className={`status-dot status-dot--${host.status}`} />
          <div>
            <strong>Pi Desktop</strong>
            <span>
              {host.status === "ready" ? t("Pi is ready") : t(host.status)}
              {" · "}SDK {host.version ?? "—"}
              {hostLaunch ? ` · PID ${hostLaunch.pid}` : ""}
            </span>
          </div>
          <span className="runtime-summary__chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <button
          className="runtime-restart"
          type="button"
          onClick={onRestartHost}
        >
          {t("Restart runtime")}
        </button>
      </div>
    </aside>
  );
}
