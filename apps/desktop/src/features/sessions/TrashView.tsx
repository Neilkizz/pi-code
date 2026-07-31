import { useEffect, useState } from "react";
import type { PersistedTask } from "@pi-desktop/protocol";
import { useI18n } from "../../i18n/I18nProvider";
import {
  archiveTask,
  deleteTask,
  listTasks,
} from "../../platform/tauri/bridge";
import { compactPath } from "./presentation";

interface TrashViewProps {
  onClose: () => void;
}

export function TrashView({ onClose }: TrashViewProps) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<PersistedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PersistedTask | null>(null);

  useEffect(() => {
    listTasks(true)
      .then((all) => setTasks(all.filter((task) => task.archived)))
      .finally(() => setLoading(false));
  }, []);

  const handleRestore = async (id: string) => {
    await archiveTask(id, false);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
    setDeleteTarget(null);
  };

  return (
    <div className="trash-view">
      <div className="trash-view__header">
        <h2>{t("Trash")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Close")}>
          ×
        </button>
      </div>

      {loading ? (
        <p className="session-list__empty">{t("Loading…")}</p>
      ) : tasks.length === 0 ? (
        <p className="session-list__empty">{t("No archived sessions")}</p>
      ) : (
        tasks.map((task) => (
          <div className="trash-item" key={task.id}>
            <div className="trash-item__info">
              <strong>{task.title}</strong>
              <small>
                {compactPath(task.cwd)}
                {" · "}
                {t("Archived")} {new Date(task.updatedAt).toLocaleDateString()}
              </small>
            </div>
            <div className="trash-item__actions">
              <button type="button" onClick={() => void handleRestore(task.id)}>
                {t("Restore")}
              </button>
              <button
                type="button"
                className="trash-item__delete"
                onClick={() => setDeleteTarget(task)}
              >
                {t("Delete permanently")}
              </button>
            </div>
          </div>
        ))
      )}

      {deleteTarget ? (
        <div className="confirm-dialog" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <p>
              {t(
                "Are you sure you want to permanently delete this session?",
              )}
            </p>
            <div className="confirm-dialog__actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="confirm-dialog__confirm"
                onClick={() => void handleDelete(deleteTarget.id)}
              >
                {t("Delete permanently")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
