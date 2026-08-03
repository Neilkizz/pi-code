import { useCallback, useEffect, useState } from "react";
import type {
  ConnectorDraft,
  ConnectorProfile,
  ConnectorTestResult,
} from "@pi-desktop/protocol";
import {
  deleteConnector,
  listConnectors,
  saveConnector,
  setConnectorEnabled,
  testConnector,
} from "../../platform/tauri/bridge";
import { useI18n } from "../../i18n/I18nProvider";

const EMPTY_DRAFT: ConnectorDraft = {
  name: "",
  command: "",
  args: [],
  env: {},
  enabled: false,
  token: "",
};

export function ConnectorCenter() {
  const { t } = useI18n();
  const [connectors, setConnectors] = useState<ConnectorProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ConnectorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, ConnectorTestResult>
  >({});

  const refresh = useCallback(() => {
    void listConnectors()
      .then(setConnectors)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(connector: ConnectorProfile): Promise<void> {
    setSaving(true);
    try {
      const updated = await setConnectorEnabled(connector.id, !connector.enabled);
      setConnectors((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!editing?.name.trim() || !editing.command.trim()) return;
    setSaving(true);
    try {
      const saved = await saveConnector(editing);
      setConnectors((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved];
      });
      setEditing(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(id: string): Promise<void> {
    setSaving(true);
    try {
      await deleteConnector(id);
      setConnectors((current) => current.filter((item) => item.id !== id));
      setPendingDelete(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function doTest(id: string): Promise<void> {
    try {
      const result = await testConnector(id);
      setTestResult((current) => ({ ...current, [id]: result }));
    } catch (error: unknown) {
      setTestResult((current) => ({
        ...current,
        [id]: { ok: false, toolCount: 0, message: String(error) },
      }));
    }
  }

  return (
    <section className="connector-center">
      <header className="connector-center__head">
        <div>
          <h2 className="connector-center__title">{t("MCP Connectors")}</h2>
          <p className="connector-center__subtitle">
            {t(
              "Connect local stdio MCP servers; their tools surface to Pi through the capability broker.",
            )}
          </p>
        </div>
        <button type="button" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
          {t("New connector")}
        </button>
      </header>

      {editing ? (
        <ConnectorForm
          draft={editing}
          saving={saving}
          onChange={setEditing}
          onSave={() => void saveDraft()}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <div className="connector-list">
        {loading ? (
          <p className="connector-list__empty">{t("Loading…")}</p>
        ) : connectors.length === 0 ? (
          <p className="connector-list__empty">
            {t("No connectors configured yet.")}
          </p>
        ) : (
          connectors.map((connector) => (
            <article className="connector-card" key={connector.id}>
              <div className="connector-card__body">
                <strong>{connector.name}</strong>
                <code className="connector-card__command">
                  {connector.command} {connector.args.join(" ")}
                </code>
                {testResult[connector.id] ? (
                  <span
                    className={`connector-card__test ${
                      testResult[connector.id].ok
                        ? "connector-card__test--ok"
                        : "connector-card__test--fail"
                    }`}
                  >
                    {testResult[connector.id].message}
                  </span>
                ) : null}
              </div>
              <div className="connector-card__actions">
                <label className="connector-toggle">
                  <input
                    type="checkbox"
                    checked={connector.enabled}
                    disabled={saving}
                    onChange={() => void toggle(connector)}
                  />
                  <span>
                    {connector.enabled ? t("Enabled") : t("Disabled")}
                  </span>
                </label>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void doTest(connector.id)}
                >
                  {t("Test")}
                </button>
                {pendingDelete === connector.id ? (
                  <>
                    <button
                      type="button"
                      className="danger-active"
                      disabled={saving}
                      onClick={() => void doDelete(connector.id)}
                    >
                      {t("Confirm delete")}
                    </button>
                    <button type="button" onClick={() => setPendingDelete(null)}>
                      {t("Cancel")}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setPendingDelete(connector.id)}>
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

function ConnectorForm({
  draft,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ConnectorDraft;
  saving: boolean;
  onChange: (draft: ConnectorDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const valid = draft.name.trim().length > 0 && draft.command.trim().length > 0;
  const argsText = draft.args.join(" ");
  return (
    <form
      className="connector-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave();
      }}
    >
      <label>
        {t("Name")}
        <input
          value={draft.name}
          placeholder="filesystem"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        {t("Command")}
        <input
          value={draft.command}
          placeholder="npx"
          onChange={(event) =>
            onChange({ ...draft, command: event.target.value })
          }
        />
      </label>
      <label>
        {t("Arguments")}
        <input
          value={argsText}
          placeholder="-y @modelcontextprotocol/server-filesystem"
          onChange={(event) =>
            onChange({
              ...draft,
              args: event.target.value
                .split(/\s+/)
                .filter((part) => part.length > 0),
            })
          }
        />
      </label>
      <label>
        {t("Auth token (optional)")}
        <input
          type="password"
          value={draft.token ?? ""}
          onChange={(event) => onChange({ ...draft, token: event.target.value })}
        />
      </label>
      <div className="connector-form__actions">
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
