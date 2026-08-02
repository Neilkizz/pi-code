import { useCallback, useEffect, useState } from "react";
import type {
  ResourceDraft,
  ResourceKind,
  ResourceProfile,
} from "@pi-desktop/protocol";
import {
  deleteResource,
  exportResource,
  importResource,
  listResources,
  saveResource,
  setResourceEnabled,
} from "../../platform/tauri/bridge";
import { useI18n } from "../../i18n/I18nProvider";

const EMPTY_DRAFT: ResourceDraft = {
  name: "",
  kind: "skill",
  description: "",
  content: "",
  enabled: false,
};

export function ResourcesCenter() {
  const { t } = useI18n();
  const [resources, setResources] = useState<ResourceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<ResourceKind>("skill");
  const [editing, setEditing] = useState<ResourceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listResources()
      .then(setResources)
      .catch((error: unknown) => setError(error))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function setError(cause: unknown): void {
    void cause;
  }

  const kindLabel = kind === "skill" ? t("Skills") : t("Prompts");

  const visible = resources.filter((resource) => resource.kind === kind);

  async function toggle(resource: ResourceProfile): Promise<void> {
    setSaving(true);
    try {
      const updated = await setResourceEnabled(resource.id, !resource.enabled);
      setResources((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error: unknown) {
      setError(error);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!editing?.name.trim() || !editing.content.trim()) return;
    setSaving(true);
    try {
      const saved = await saveResource(editing);
      setResources((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved];
      });
      setEditing(null);
    } catch (error: unknown) {
      setError(error);
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(id: string): Promise<void> {
    setSaving(true);
    try {
      await deleteResource(id);
      setResources((current) => current.filter((item) => item.id !== id));
      setPendingDelete(null);
    } catch (error: unknown) {
      setError(error);
    } finally {
      setSaving(false);
    }
  }

  async function doImport(): Promise<void> {
    setSaving(true);
    try {
      const imported = await importResource(kind);
      if (imported) {
        setResources((current) => [...current, imported]);
      }
    } catch (error: unknown) {
      setError(error);
    } finally {
      setSaving(false);
    }
  }

  async function doExport(id: string): Promise<void> {
    try {
      await exportResource(id);
    } catch (error: unknown) {
      setError(error);
    }
  }

  return (
    <section className="resource-center">
      <header className="resource-center__head">
        <div className="resource-center__tabs" role="tablist">
          <button
            type="button"
            className={kind === "skill" ? "is-active" : ""}
            onClick={() => setKind("skill")}
            role="tab"
            aria-selected={kind === "skill"}
          >
            {t("Skills")}
          </button>
          <button
            type="button"
            className={kind === "prompt" ? "is-active" : ""}
            onClick={() => setKind("prompt")}
            role="tab"
            aria-selected={kind === "prompt"}
          >
            {t("Prompts")}
          </button>
        </div>
        <div className="resource-center__actions">
          <button
            type="button"
            disabled={saving}
            onClick={() => void doImport()}
          >
            {t("Import")}
          </button>
          <button
            type="button"
            onClick={() => setEditing({ ...EMPTY_DRAFT, kind })}
          >
            {t("New {kind}", { kind: kindLabel })}
          </button>
        </div>
      </header>

      {editing ? (
        <ResourceForm
          draft={editing}
          saving={saving}
          onChange={setEditing}
          onSave={() => void saveDraft()}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <div className="resource-list">
        {loading ? (
          <p className="resource-list__empty">{t("Loading…")}</p>
        ) : visible.length === 0 ? (
          <p className="resource-list__empty">
            {t("No {kind} yet.", { kind: kindLabel })}
          </p>
        ) : (
          visible.map((resource) => (
            <article className="resource-card" key={resource.id}>
              <div className="resource-card__body">
                <strong>{resource.name}</strong>
                {resource.description ? (
                  <span>{resource.description}</span>
                ) : null}
              </div>
              <div className="resource-card__actions">
                <label className="resource-toggle">
                  <input
                    type="checkbox"
                    checked={resource.enabled}
                    disabled={saving}
                    onChange={() => void toggle(resource)}
                  />
                  <span>{resource.enabled ? t("Enabled") : t("Disabled")}</span>
                </label>
                <button type="button" onClick={() => void doExport(resource.id)}>
                  {t("Export")}
                </button>
                {pendingDelete === resource.id ? (
                  <>
                    <button
                      type="button"
                      className="danger-active"
                      disabled={saving}
                      onClick={() => void doDelete(resource.id)}
                    >
                      {t("Confirm delete")}
                    </button>
                    <button type="button" onClick={() => setPendingDelete(null)}>
                      {t("Cancel")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(resource.id)}
                  >
                    {t("Delete")}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ResourceForm({
  draft,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ResourceDraft;
  saving: boolean;
  onChange: (draft: ResourceDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const valid = draft.name.trim().length > 0 && draft.content.trim().length > 0;
  return (
    <form
      className="resource-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave();
      }}
    >
      <label>
        {t("Name")}
        <input
          value={draft.name}
          placeholder="my-skill"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        {t("Description")}
        <input
          value={draft.description ?? ""}
          onChange={(event) =>
            onChange({ ...draft, description: event.target.value })
          }
        />
      </label>
      <label>
        {t("Content")}
        <textarea
          className="resource-form__content"
          value={draft.content}
          onChange={(event) =>
            onChange({ ...draft, content: event.target.value })
          }
        />
      </label>
      <div className="resource-form__actions">
        <button type="button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={saving || !valid}
        >
          {t("Save")}
        </button>
      </div>
    </form>
  );
}
