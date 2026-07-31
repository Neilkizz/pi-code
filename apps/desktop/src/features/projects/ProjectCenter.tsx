import type { PersistedTask, ProjectSummary } from "@pi-desktop/protocol";
import { useEffect, useMemo, useState } from "react";
import { NavIcon } from "../../design-system/NavIcon";
import { useI18n } from "../../i18n/I18nProvider";
import { filterProjects } from "./presentation";

interface ProjectCenterProps {
  projects: ProjectSummary[];
  tasks: PersistedTask[];
  onOpenFolder: () => void;
  onNewTask: (project: ProjectSummary) => void;
  onOpenTask: (task: PersistedTask) => void;
  onSaveInstructions: (project: ProjectSummary, instructions: string) => Promise<void>;
}

export function ProjectCenter({
  projects,
  tasks,
  onOpenFolder,
  onNewTask,
  onOpenTask,
  onSaveInstructions,
}: ProjectCenterProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => projects[0]?.id ?? null,
  );
  const [instructions, setInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const visibleProjects = useMemo(
    () => filterProjects(projects, query),
    [projects, query],
  );
  const selectedProject =
    visibleProjects.find((project) => project.id === selectedProjectId) ??
    visibleProjects[0];
  const selectedTasks = selectedProject
    ? tasks.filter((task) => task.projectRoot === selectedProject.root)
    : [];

  useEffect(() => {
    if (selectedProject && selectedProject.id !== selectedProjectId) {
      setSelectedProjectId(selectedProject.id);
    }
  }, [selectedProject, selectedProjectId]);

  useEffect(() => {
    setInstructions(selectedProject?.instructions ?? "");
  }, [selectedProject?.id, selectedProject?.instructions]);

  async function saveInstructions(): Promise<void> {
    if (!selectedProject || savingInstructions) return;
    setSavingInstructions(true);
    try {
      await onSaveInstructions(selectedProject, instructions);
    } finally {
      setSavingInstructions(false);
    }
  }

  return (
    <section className="project-center" aria-label={t("Projects")}>
      <header className="project-center__header">
        <div>
          <span className="workspace__eyebrow">{t("Workspace")}</span>
          <h2>{t("Projects")}</h2>
          <p>{t("Projects keep local tasks, project files, and working context together.")}</p>
        </div>
        <button className="button project-center__open" type="button" onClick={onOpenFolder}>
          <span aria-hidden="true">+</span>
          {t("Open project folder")}
        </button>
      </header>

      {projects.length === 0 ? (
        <section className="project-empty panel">
          <span className="project-empty__icon" aria-hidden="true"><NavIcon name="folder" /></span>
          <h3>{t("Start with a local project")}</h3>
          <p>{t("Choose a folder to create an isolated Pi task. Your project appears here after its first task is saved.")}</p>
          <button className="button" type="button" onClick={onOpenFolder}>
            {t("Choose folder")}
          </button>
        </section>
      ) : (
        <div className="project-layout">
          <aside className="project-list panel" aria-label={t("Project list")}>
            <label className="sr-only" htmlFor="project-search">{t("Search projects")}</label>
            <input
              id="project-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search projects")}
            />
            <div className="project-list__items">
              {visibleProjects.map((project) => {
                const active = project.id === selectedProject?.id;
                return (
                  <button
                    key={project.id}
                    className={`project-list__item ${active ? "project-list__item--active" : ""}`}
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    aria-pressed={active}
                  >
                    <span className="project-card__icon" aria-hidden="true"><NavIcon name="folder" /></span>
                    <span>
                      <strong>{project.displayName}</strong>
                      <small>{t("{count} active tasks", { count: project.taskCount })}</small>
                    </span>
                  </button>
                );
              })}
              {visibleProjects.length === 0 ? <p className="project-list__empty">{t("No matching projects")}</p> : null}
            </div>
          </aside>
          {selectedProject ? (
            <section className="project-detail">
              <div className="project-detail__header">
                <div>
                  <span className="workspace__eyebrow">{t("Project")}</span>
                  <h3>{selectedProject.displayName}</h3>
                  <p title={selectedProject.root}>{selectedProject.root}</p>
                </div>
                <button type="button" className="button" onClick={() => onNewTask(selectedProject)}>
                  {t("New task")}
                </button>
              </div>
              <section className="project-tasks panel" aria-label={t("Tasks in {name}", { name: selectedProject.displayName })}>
                <header>
                  <strong>{t("Recent tasks")}</strong>
                  <span>{t("{count} active tasks", { count: selectedProject.taskCount })}</span>
                </header>
                {selectedTasks.length === 0 ? (
                  <div className="project-tasks__empty">
                    <p>{t("No active tasks in this project")}</p>
                    <button type="button" className="button button--quiet" onClick={() => onNewTask(selectedProject)}>{t("New task")}</button>
                  </div>
                ) : (
                  <div className="project-task-list">
                    {selectedTasks.map((task) => (
                      <button type="button" key={task.id} onClick={() => onOpenTask(task)}>
                        <span className={`project-task-list__dot project-task-list__dot--${task.archived ? "archived" : "active"}`} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>{task.worktree?.branch ?? t(task.isolation === "readOnly" ? "Read only" : "Current checkout")}</small>
                        </span>
                        <span>{relativeDate(task.lastOpenedAt, t)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="project-instructions panel" aria-label={t("Project instructions")}>
                <header>
                  <div>
                    <strong>{t("Project instructions")}</strong>
                    <p>{t("Applied to every new and restored Pi task in this project. Stored locally and visible here.")}</p>
                  </div>
                  <button type="button" className="button button--quiet" onClick={() => void saveInstructions()} disabled={savingInstructions || instructions === selectedProject.instructions}>
                    {savingInstructions ? t("Saving…") : t("Save")}
                  </button>
                </header>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder={t("Example: use the existing patterns, run the relevant tests, and explain any tradeoffs.")}
                  rows={6}
                  maxLength={32_768}
                />
              </section>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}

function relativeDate(value: number, t: (key: string, variables?: Record<string, string | number>) => string): string {
  const elapsed = Math.max(0, Date.now() - value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("Just now");
  if (minutes < 60) return t("{count} min ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count} hr ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("{count} days ago", { count: days });
}
