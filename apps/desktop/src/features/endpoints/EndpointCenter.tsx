import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EndpointDraft,
  EndpointKind,
  EndpointProfile,
  EndpointTestResult,
} from "@pi-desktop/protocol";
import { useI18n } from "../../i18n/I18nProvider";
import {
  deleteEndpoint,
  discoverEndpoint,
  listEndpoints,
  saveEndpoint,
  testEndpoint,
} from "../../platform/tauri/bridge";

const blankDraft: EndpointDraft = {
  name: "",
  kind: "openai-compatible",
  baseUrl: "",
  defaultModel: "",
  models: [],
  enabled: true,
  isDefault: false,
  apiKey: "",
  clearApiKey: false,
};

export function EndpointCenter({
  onProfilesChanged,
}: {
  onProfilesChanged?: (endpoints: EndpointProfile[]) => void;
}) {
  const { t } = useI18n();
  const [endpoints, setEndpoints] = useState<EndpointProfile[]>([]);
  const [draft, setDraft] = useState<EndpointDraft>(blankDraft);
  const [modelsInput, setModelsInput] = useState("");
  const [editingHasKey, setEditingHasKey] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    endpointId: string;
    result: EndpointTestResult;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<{
    status: "idle" | "waiting" | "loading" | "success" | "error";
    message?: string;
    latencyMs?: number;
  }>({ status: "idle" });
  const discoverySequence = useRef(0);
  const availableModels = useMemo(() => parseModels(modelsInput), [modelsInput]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const sequence = ++discoverySequence.current;
    if (
      !isDiscoverableUrl(draft.baseUrl) ||
      (draft.kind !== "ollama" &&
        !draft.apiKey?.trim() &&
        !editingHasKey)
    ) {
      setDiscovery({ status: "idle" });
      return;
    }

    setDiscovery({
      status: "waiting",
      message: t("Waiting for endpoint input to settle…"),
    });
    const timer = window.setTimeout(() => {
      void discoverDraftModels(sequence);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    draft.id,
    draft.kind,
    draft.baseUrl,
    draft.apiKey,
    editingHasKey,
    t,
  ]);

  async function refresh(): Promise<void> {
    try {
      const profiles = await listEndpoints();
      setEndpoints(profiles);
      onProfilesChanged?.(profiles);
    } catch (cause: unknown) {
      setError(toMessage(cause));
    }
  }

  function update<K extends keyof EndpointDraft>(
    field: K,
    value: EndpointDraft[K],
  ): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function edit(endpoint: EndpointProfile): void {
    setDraft({
      id: endpoint.id,
      name: endpoint.name,
      kind: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      defaultModel: endpoint.defaultModel ?? "",
      models: endpoint.models,
      enabled: endpoint.enabled,
      isDefault: endpoint.isDefault,
      apiKey: "",
      clearApiKey: false,
    });
    setModelsInput(endpoint.models.join(", "));
    setEditingHasKey(endpoint.hasApiKey);
    setError(null);
  }

  function resetForm(): void {
    discoverySequence.current += 1;
    setDraft(blankDraft);
    setModelsInput("");
    setEditingHasKey(false);
    setDiscovery({ status: "idle" });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const discovered =
        availableModels.length === 0
          ? await discoverDraftModels(++discoverySequence.current)
          : null;
      const models = discovered?.models.length
        ? discovered.models
        : availableModels;
      await saveEndpoint({
        ...draft,
        models,
        apiKey: draft.apiKey || undefined,
        defaultModel:
          draft.defaultModel?.trim() || models[0] || undefined,
      });
      await refresh();
      resetForm();
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function runTest(endpoint: EndpointProfile): Promise<void> {
    setTesting(endpoint.id);
    setError(null);
    try {
      const result = await testEndpoint(endpoint.id);
      setTestResult({ endpointId: endpoint.id, result });
      if (result.models.length > 0) {
        await saveEndpoint({
          id: endpoint.id,
          name: endpoint.name,
          kind: endpoint.kind,
          baseUrl: endpoint.baseUrl,
          defaultModel: endpoint.defaultModel ?? result.models[0],
          models: result.models,
          enabled: endpoint.enabled,
          isDefault: endpoint.isDefault,
          clearApiKey: false,
        });
        await refresh();
      }
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setTesting(null);
    }
  }

  async function discoverDraftModels(
    sequence = ++discoverySequence.current,
  ): Promise<EndpointTestResult | null> {
    if (!isDiscoverableUrl(draft.baseUrl)) {
      return null;
    }
    setDiscovery({
      status: "loading",
      message: t("Fetching the provider model catalog…"),
    });
    try {
      const result = await discoverEndpoint({
        id: draft.id,
        kind: draft.kind,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey?.trim() || undefined,
      });
      if (sequence !== discoverySequence.current) {
        return null;
      }
      if (result.models.length > 0) {
        setModelsInput(result.models.join(", "));
        setDraft((current) => ({
          ...current,
          models: result.models,
          defaultModel:
            current.defaultModel &&
            result.models.includes(current.defaultModel)
              ? current.defaultModel
              : result.models[0],
        }));
      }
      setDiscovery({
        status: "success",
        message: result.models.length
          ? t("Discovered {count} models", { count: result.models.length })
          : `${result.message}; ${t("No model ids were returned")}`,
        latencyMs: result.latencyMs,
      });
      return result;
    } catch (cause: unknown) {
      if (sequence === discoverySequence.current) {
        setDiscovery({
          status: "error",
          message: toMessage(cause),
        });
      }
      return null;
    }
  }

  async function remove(id: string): Promise<void> {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      return;
    }

    setBusy(true);
    try {
      await deleteEndpoint(id);
      await refresh();
      if (draft.id === id) {
        resetForm();
      }
      setPendingDelete(null);
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="workspace__header">
        <div>
          <span className="workspace__eyebrow">{t("Settings")}</span>
          <h2>{t("Endpoints")}</h2>
          <p className="workspace__description">
            {t(
              "Manage model gateways, local runtimes, and API credentials stored securely.",
            )}
          </p>
        </div>
        <span className="badge">
          {t("{count} configured", { count: endpoints.length })}
        </span>
      </header>

      <section className="endpoint-layout">
        <div className="panel endpoint-form">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">
                {draft.id ? t("Edit profile") : t("New profile")}
              </span>
              <h3>
                {draft.id ? draft.name : t("Connect an API endpoint")}
              </h3>
            </div>
            {draft.id ? (
              <button className="text-button" type="button" onClick={resetForm}>
                {t("New")}
              </button>
            ) : null}
          </div>

          <div className="form-grid">
            <label className="field">
              <span>{t("Name")}</span>
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Team Gateway"
              />
            </label>

            <label className="field">
              <span>{t("Protocol")}</span>
              <select
                value={draft.kind}
                onChange={(event) =>
                  update("kind", event.target.value as EndpointKind)
                }
              >
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">
                  Anthropic Compatible
                </option>
                <option value="ollama">Ollama / Local</option>
              </select>
            </label>

            <label className="field field--wide">
              <span>{t("Base URL")}</span>
              <input
                value={draft.baseUrl}
                onChange={(event) => update("baseUrl", event.target.value)}
                placeholder={
                  draft.kind === "ollama"
                    ? "http://localhost:11434/v1"
                    : "https://api.example.com/v1"
                }
              />
            </label>

            <label className="field">
              <span>{t("Default model")}</span>
              {availableModels.length ? (
                <select
                  value={draft.defaultModel ?? availableModels[0]}
                  onChange={(event) =>
                    update("defaultModel", event.target.value)
                  }
                >
                  {availableModels.map((model) => (
                    <option value={model} key={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft.defaultModel ?? ""}
                  onChange={(event) =>
                    update("defaultModel", event.target.value)
                  }
                  placeholder={t("Discovered automatically")}
                />
              )}
            </label>

            <label className="field">
              <span>{t("API Key")}</span>
              <input
                type="password"
                value={draft.apiKey ?? ""}
                onChange={(event) => update("apiKey", event.target.value)}
                placeholder={
                  editingHasKey
                    ? t("Saved in Keychain · leave blank to keep")
                    : draft.kind === "ollama"
                      ? t("Not required")
                      : t("Stored only in macOS Keychain")
                }
                autoComplete="off"
              />
            </label>

            <div className="field field--wide endpoint-discovery">
              <div className="endpoint-discovery__header">
                <span>{t("Model catalog")}</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void discoverDraftModels()}
                  disabled={
                    discovery.status === "loading" ||
                    !isDiscoverableUrl(draft.baseUrl)
                  }
                >
                  {discovery.status === "loading"
                    ? t("Discovering…")
                    : t("Discover now")}
                </button>
              </div>
              <div
                className={`endpoint-discovery__status endpoint-discovery__status--${discovery.status}`}
                role={discovery.status === "error" ? "alert" : "status"}
              >
                <span className="status-dot" />
                <strong>
                  {discovery.message ??
                    t(
                      "Enter the endpoint and API key to fetch models automatically.",
                    )}
                </strong>
                {discovery.latencyMs !== undefined ? (
                  <small>{discovery.latencyMs} ms</small>
                ) : null}
              </div>
              <details className="endpoint-models-manual">
                <summary>
                  {availableModels.length
                    ? t("{count} models · edit manually", {
                        count: availableModels.length,
                      })
                    : t("Enter model ids manually")}
                </summary>
                <textarea
                  value={modelsInput}
                  onChange={(event) => setModelsInput(event.target.value)}
                  placeholder="model-a, model-b"
                  rows={3}
                />
              </details>
            </div>
          </div>

          <div className="option-row">
            <label className="check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
              />
              {t("Enabled")}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(event) => update("isDefault", event.target.checked)}
              />
              {t("Default endpoint")}
            </label>
            {editingHasKey ? (
              <label className="check check--danger">
                <input
                  type="checkbox"
                  checked={draft.clearApiKey}
                  onChange={(event) =>
                    update("clearApiKey", event.target.checked)
                  }
                />
                {t("Remove saved key")}
              </label>
            ) : null}
          </div>

          <button
            className="button button--primary button--full"
            type="button"
            onClick={submit}
            disabled={busy || !draft.name.trim() || !draft.baseUrl.trim()}
          >
            {busy
              ? t("Saving…")
              : draft.id
                ? t("Save Changes")
                : t("Add Endpoint")}
          </button>
        </div>

        <div className="endpoint-list">
          {endpoints.length === 0 ? (
            <div className="panel endpoint-empty">
              <span>01</span>
              <h3>{t("No endpoints yet")}</h3>
              <p>
                {t(
                  "Add an OpenAI-compatible, Anthropic-compatible, or local Ollama endpoint. Keys are never written to endpoints.json.",
                )}
              </p>
            </div>
          ) : (
            endpoints.map((endpoint) => (
              <article className="panel endpoint-card" key={endpoint.id}>
                <div className="endpoint-card__top">
                  <div>
                    <div className="endpoint-card__name">
                      <h3>{endpoint.name}</h3>
                      {endpoint.isDefault ? (
                        <span>{t("Default")}</span>
                      ) : null}
                    </div>
                    <p>{endpoint.baseUrl}</p>
                  </div>
                  <span
                    className={`status-dot status-dot--${
                      endpoint.enabled ? "ready" : "idle"
                    }`}
                  />
                </div>
                <dl className="endpoint-meta">
                  <div>
                    <dt>{t("Protocol")}</dt>
                    <dd>{labelForKind(endpoint.kind)}</dd>
                  </div>
                  <div>
                    <dt>{t("Model")}</dt>
                    <dd>{endpoint.defaultModel ?? t("Discover required")}</dd>
                  </div>
                  <div>
                    <dt>{t("Credential")}</dt>
                    <dd>
                      {endpoint.hasApiKey ? t("Keychain") : t("None")}
                    </dd>
                  </div>
                </dl>

                {testResult?.endpointId === endpoint.id ? (
                  <div
                    className={`test-result ${
                      testResult.result.reachable
                        ? "test-result--ok"
                        : "test-result--error"
                    }`}
                  >
                    <strong>{testResult.result.message}</strong>
                    <span>
                      HTTP {testResult.result.statusCode} ·{" "}
                      {testResult.result.latencyMs} ms ·{" "}
                      {t("{count} models", {
                        count: testResult.result.models.length,
                      })}
                    </span>
                    {testResult.result.models.length ? (
                      <em>{t("Model catalog updated automatically")}</em>
                    ) : null}
                  </div>
                ) : null}

                <div className="endpoint-actions">
                  <button type="button" onClick={() => edit(endpoint)}>
                    {t("Edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => runTest(endpoint)}
                    disabled={testing === endpoint.id}
                  >
                    {testing === endpoint.id
                      ? t("Refreshing…")
                      : t("Refresh models")}
                  </button>
                  <button
                    className={
                      pendingDelete === endpoint.id ? "danger-active" : ""
                    }
                    type="button"
                    onClick={() => remove(endpoint.id)}
                  >
                    {pendingDelete === endpoint.id
                      ? t("Confirm Delete")
                      : t("Delete")}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {error ? (
        <section className="error-banner" role="alert">
          <strong>{t("Endpoint error")}</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            {t("Dismiss")}
          </button>
        </section>
      ) : null}
    </>
  );
}

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter(Boolean);
}

function isDiscoverableUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function labelForKind(kind: EndpointKind): string {
  switch (kind) {
    case "openai-compatible":
      return "OpenAI Compatible";
    case "anthropic-compatible":
      return "Anthropic Compatible";
    case "ollama":
      return "Ollama / Local";
  }
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
