import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExtensionDraft,
  ExtensionFinding,
  ExtensionProfile,
  ExtensionScanResult,
  ExtensionUpdate,
  MarketplacePage,
  MarketplaceSort,
  PiAgentUpdateStatus,
  UpdatePreferences,
} from "@pi-desktop/protocol";
import { useI18n } from "../../i18n/I18nProvider";
import {
  activateExtensionVersion,
  deleteExtension,
  getPiAgentUpdateStatus,
  getUpdatePreferences,
  installMarketplacePackage,
  installPiAgentUpdate,
  listExtensionUpdates,
  listExtensions,
  listMarketplace,
  pickExtensionPath,
  saveExtension,
  saveUpdatePreferences,
  scanExtension,
  setExtensionEnabled,
  updateExtension,
} from "../../platform/tauri/bridge";

const blankDraft: ExtensionDraft = {
  name: "",
  sourcePath: "",
  enabled: false,
  approved: false,
};

export function ExtensionCenter() {
  const { locale, t } = useI18n();
  const [view, setView] = useState<"installed" | "marketplace">("installed");
  const [extensions, setExtensions] = useState<ExtensionProfile[]>([]);
  const [draft, setDraft] = useState<ExtensionDraft>(blankDraft);
  const [scan, setScan] = useState<ExtensionScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketplacePage | null>(null);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSort, setMarketSort] =
    useState<MarketplaceSort>("downloads");
  const [marketPage, setMarketPage] = useState(1);
  const [marketLoading, setMarketLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [updates, setUpdates] = useState<ExtensionUpdate[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [piUpdate, setPiUpdate] = useState<PiAgentUpdateStatus | null>(null);
  const [piChecking, setPiChecking] = useState(false);
  const [piInstalling, setPiInstalling] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [updatePreferences, setUpdatePreferences] =
    useState<UpdatePreferences>({
      autoUpdatePiAgent: false,
      autoUpdateExtensions: false,
    });
  const marketSequence = useRef(0);

  const elevatedFindings = useMemo(
    () =>
      scan?.findings.filter((finding) => finding.severity !== "info") ?? [],
    [scan],
  );
  const installedPackages = useMemo(
    () =>
      new Set(
        extensions
          .map((extension) => extension.packageName)
          .filter((name): name is string => Boolean(name)),
      ),
    [extensions],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (view === "installed") {
      void checkUpdates();
      void refreshPiUpdate();
    }
  }, [view]);

  useEffect(() => {
    if (view !== "marketplace") {
      return;
    }
    const sequence = ++marketSequence.current;
    const timer = window.setTimeout(() => {
      void refreshMarket(sequence);
    }, marketSearch ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [view, marketSearch, marketSort, marketPage]);

  async function refresh(): Promise<void> {
    try {
      setExtensions(await listExtensions());
    } catch (cause: unknown) {
      setError(toMessage(cause));
    }
  }

  async function refreshMarket(
    sequence = ++marketSequence.current,
  ): Promise<void> {
    setMarketLoading(true);
    setError(null);
    try {
      const result = await listMarketplace({
        search: marketSearch.trim() || undefined,
        sort: marketSort,
        page: marketPage,
      });
      if (sequence === marketSequence.current) {
        setMarket(result);
      }
    } catch (cause: unknown) {
      if (sequence === marketSequence.current) {
        setError(toMessage(cause));
      }
    } finally {
      if (sequence === marketSequence.current) {
        setMarketLoading(false);
      }
    }
  }

  async function checkUpdates(): Promise<void> {
    setCheckingUpdates(true);
    try {
      setUpdates(await listExtensionUpdates());
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function refreshPiUpdate(): Promise<void> {
    setPiChecking(true);
    try {
      const preferences = await getUpdatePreferences();
      setUpdatePreferences(preferences);
      const status = await getPiAgentUpdateStatus();
      setPiUpdate(status);
      setUpdatePreferences(status.preferences);
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setPiChecking(false);
    }
  }

  async function changeUpdatePreference(
    field: keyof UpdatePreferences,
    value: boolean,
  ): Promise<void> {
    const previous = updatePreferences;
    const next = { ...previous, [field]: value };
    setUpdatePreferences(next);
    setPreferenceSaving(true);
    setError(null);
    try {
      const saved = await saveUpdatePreferences(next);
      setUpdatePreferences(saved);
      setPiUpdate((current) =>
        current ? { ...current, preferences: saved } : current,
      );
    } catch (cause: unknown) {
      setUpdatePreferences(previous);
      setError(toMessage(cause));
    } finally {
      setPreferenceSaving(false);
    }
  }

  async function installCoreUpdate(): Promise<void> {
    setPiInstalling(true);
    setError(null);
    setNotice(null);
    try {
      const status = await installPiAgentUpdate();
      setPiUpdate(status);
      setNotice(
        status.restartRequired
          ? t(
              "Pi-Agent {version} was downloaded and passed protocol preflight. Restart Pi Desktop to activate it.",
              { version: status.latestVersion },
            )
          : t("Pi-Agent {version} is already up to date.", {
              version: status.activeVersion,
            }),
      );
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setPiInstalling(false);
    }
  }

  function update<K extends keyof ExtensionDraft>(
    field: K,
    value: ExtensionDraft[K],
  ): void {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "sourcePath") {
        next.approved = false;
        next.approvedContentHash = undefined;
      }
      if (field === "approved") {
        next.approvedContentHash = value ? scan?.contentHash : undefined;
      }
      return next;
    });
    if (field === "sourcePath") {
      setScan(null);
    }
  }

  async function runScan(): Promise<void> {
    if (!draft.sourcePath.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await scanExtension(draft.sourcePath);
      setScan(result);
      setDraft((current) => ({
        ...current,
        sourcePath: result.sourcePath,
        approved: false,
        approvedContentHash: undefined,
      }));
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function browse(directory: boolean): Promise<void> {
    setError(null);
    try {
      const sourcePath = await pickExtensionPath(directory);
      if (sourcePath) {
        update("sourcePath", sourcePath);
      }
    } catch (cause: unknown) {
      setError(toMessage(cause));
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await saveExtension(draft);
      await refresh();
      resetForm();
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function edit(extension: ExtensionProfile): void {
    if (extension.sourceKind === "npm") {
      setPendingApproval(extension.id);
      setNotice(
        t(
          "{name} is in quarantine. Review the security findings before enabling it.",
          { name: extension.name },
        ),
      );
      return;
    }
    setDraft({
      id: extension.id,
      name: extension.name,
      sourcePath: extension.sourcePath,
      enabled: extension.enabled,
      approved: extension.approved,
      approvedContentHash: extension.approved
        ? extension.contentHash
        : undefined,
    });
    setScan({
      sourcePath: extension.sourcePath,
      contentHash: extension.contentHash,
      findings: extension.findings,
      scannedFiles: extension.scannedFiles,
      scannedBytes: extension.scannedBytes,
    });
    setError(null);
  }

  async function toggle(extension: ExtensionProfile): Promise<void> {
    const elevated = extension.findings.some(
      (finding) => finding.severity !== "info",
    );
    if (
      !extension.enabled &&
      elevated &&
      !extension.approved &&
      pendingApproval !== extension.id
    ) {
      setPendingApproval(extension.id);
      setNotice(
        t(
          "Open Security review first. Click again to approve the current content hash and enable it.",
        ),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setExtensionEnabled(
        extension.id,
        !extension.enabled,
        !extension.enabled && elevated
          ? extension.contentHash
          : undefined,
      );
      await refresh();
      setPendingApproval(null);
      setNotice(
        extension.enabled
          ? t("{name} was disabled.", { name: extension.name })
          : t("{name} is enabled in a restricted worker.", {
              name: extension.name,
            }),
      );
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function installFromMarket(
    packageName: string,
    version: string,
  ): Promise<void> {
    setInstalling(packageName);
    setError(null);
    setNotice(null);
    try {
      const extension = await installMarketplacePackage(
        packageName,
        version || undefined,
      );
      await refresh();
      setView("installed");
      setPendingApproval(extension.id);
      setNotice(
        t(
          "{package}@{version} was downloaded and scanned in quarantine. It is not enabled yet.",
          {
            package: packageName,
            version: extension.packageVersion ?? version,
          },
        ),
      );
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setInstalling(null);
    }
  }

  async function updatePackage(extension: ExtensionProfile): Promise<void> {
    setUpdating(extension.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateExtension(extension.id);
      await refresh();
      await checkUpdates();
      setPendingApproval(updated.id);
      setNotice(
        updated.enabled
          ? t(
              "{name}@{version} was updated and passed an info-only security scan, so it remains enabled.",
              {
                name: updated.name,
                version: updated.packageVersion ?? "latest",
              },
            )
          : t(
              "{name}@{version} was updated to a new quarantined snapshot. Capability changes require review, so it is disabled.",
              {
                name: updated.name,
                version: updated.packageVersion ?? "latest",
              },
            ),
      );
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setUpdating(null);
    }
  }

  async function updateAllPackages(): Promise<void> {
    const available = updates.filter((update) => update.updateAvailable);
    for (const update of available) {
      const extension = extensions.find(
        (candidate) => candidate.id === update.id,
      );
      if (!extension) {
        continue;
      }
      await updatePackage(extension);
    }
  }

  async function activateVersion(
    extensionId: string,
    contentHash: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await activateExtensionVersion(extensionId, contentHash);
      await refresh();
    } catch (cause: unknown) {
      setError(toMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      return;
    }
    setBusy(true);
    try {
      await deleteExtension(id);
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

  function resetForm(): void {
    setDraft(blankDraft);
    setScan(null);
  }

  return (
    <>
      <header className="workspace__header">
        <div>
          <span className="workspace__eyebrow">{t("Settings")}</span>
          <h2>{t("Extensions")}</h2>
          <p className="workspace__description">
            {t(
              "Review, isolate, and manage Pi Extensions. Every task loads only verified immutable snapshots in a restricted worker.",
            )}
          </p>
        </div>
        <div className="extension-header-actions">
          {view === "installed" ? (
            updates.some((update) => update.updateAvailable) ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={updating !== null}
                onClick={() => void updateAllPackages()}
              >
                {updating
                  ? t("Updating…")
                  : t("Update all ({count})", {
                      count: updates.filter(
                        (update) => update.updateAvailable,
                      ).length,
                    })}
              </button>
            ) : (
              <button
                className="text-button"
                type="button"
                disabled={checkingUpdates}
                onClick={() => void checkUpdates()}
              >
                {checkingUpdates ? t("Checking…") : t("Check updates")}
              </button>
            )
          ) : null}
          <div
            className="segmented-control"
            aria-label={t("Extensions")}
          >
            <button
              type="button"
              className={view === "installed" ? "is-active" : ""}
              onClick={() => setView("installed")}
            >
              {t("Installed")}
            </button>
            <button
              type="button"
              className={view === "marketplace" ? "is-active" : ""}
              onClick={() => setView("marketplace")}
            >
              {t("Marketplace")}
            </button>
          </div>
          <span className="badge">
            {t("{count} registered", { count: extensions.length })}
          </span>
        </div>
      </header>

      {notice ? (
        <section className="notice-banner" role="status">
          <strong>{t("Extension status")}</strong>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            {t("Dismiss")}
          </button>
        </section>
      ) : null}

      {view === "marketplace" ? (
        <section className="marketplace">
          <div className="panel marketplace-toolbar">
            <div>
              <span className="panel__eyebrow">
                {t("Official Pi Catalog")}
              </span>
              <h3>{t("Browse extensions")}</h3>
              <p>
                {t(
                  "Catalog content comes directly from pi.dev. Exact npm versions are installed with lifecycle scripts disabled, then scanned locally before you can enable them. Catalog inclusion is not a security endorsement.",
                )}
              </p>
            </div>
            <div className="marketplace-toolbar__controls">
              <label className="field">
                <span className="sr-only">{t("Search marketplace")}</span>
                <input
                  type="search"
                  value={marketSearch}
                  onChange={(event) => {
                    setMarketSearch(event.target.value);
                    setMarketPage(1);
                  }}
                  placeholder={t("Search the official catalog…")}
                />
              </label>
              <label className="field">
                <span className="sr-only">{t("Sort marketplace")}</span>
                <select
                  value={marketSort}
                  onChange={(event) => {
                    setMarketSort(event.target.value as MarketplaceSort);
                    setMarketPage(1);
                  }}
                >
                  <option value="downloads">{t("Most downloaded")}</option>
                  <option value="recent">{t("Recently published")}</option>
                  <option value="name">{t("Name A–Z")}</option>
                </select>
              </label>
              <button
                className="button button--quiet"
                type="button"
                disabled={marketLoading}
                onClick={() => void refreshMarket()}
              >
                {marketLoading ? t("Refreshing…") : t("Refresh")}
              </button>
            </div>
          </div>

          <div className="marketplace-grid" aria-busy={marketLoading}>
            {marketLoading && !market ? (
              <div className="panel marketplace-empty">
                <span className="marketplace-spinner" />
                <h3>{t("Loading official catalog")}</h3>
                <p>{t("Fetching the extension catalog from pi.dev.")}</p>
              </div>
            ) : market?.packages.length ? (
              market.packages.map((item) => {
                const installed = installedPackages.has(item.name);
                return (
                  <article className="panel marketplace-card" key={item.name}>
                    <div className="marketplace-card__top">
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.description}</p>
                      </div>
                      <span>{item.version || t("latest")}</span>
                    </div>
                    <div className="marketplace-card__meta">
                      <span>{item.author || t("npm publisher")}</span>
                      <span>
                        {formatDownloads(item.downloads, locale)}/{t("mo")}
                      </span>
                      {item.types.map((type) => (
                        <span key={type}>{type}</span>
                      ))}
                    </div>
                    <div className="marketplace-card__footer">
                      <small>
                        {t("Pi official catalog · npm exact version")}
                      </small>
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={installed || installing !== null}
                        onClick={() =>
                          void installFromMarket(item.name, item.version)
                        }
                      >
                        {installing === item.name
                          ? t("Installing…")
                          : installed
                            ? t("Installed")
                            : t("Add for review")}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="panel marketplace-empty">
                <span>⌕</span>
                <h3>{t("No matching extensions")}</h3>
                <p>{t("Try a shorter name or a different sort order.")}</p>
              </div>
            )}
          </div>

          {market ? (
            <nav
              className="marketplace-pagination"
              aria-label={t("Marketplace")}
            >
              <button
                type="button"
                disabled={marketPage <= 1 || marketLoading}
                onClick={() => setMarketPage((current) => current - 1)}
              >
                {t("Previous")}
              </button>
              <span>
                {t("Page {page} of {total}", {
                  page: market.page,
                  total: market.totalPages,
                })}
              </span>
              <button
                type="button"
                disabled={marketPage >= market.totalPages || marketLoading}
                onClick={() => setMarketPage((current) => current + 1)}
              >
                {t("Next")}
              </button>
            </nav>
          ) : null}
        </section>
      ) : (
      <>
      <section className="panel update-center" aria-busy={piChecking}>
        <div className="update-center__intro">
          <span className="panel__eyebrow">{t("Updates")}</span>
          <h3>{t("Pi runtime & extensions")}</h3>
          <p>
            {t(
              "Core updates install in an isolated directory and pass a protocol preflight before activation. Extension updates always create a new immutable snapshot.",
            )}
          </p>
        </div>
        <div className="update-center__core">
          <div>
            <span>{t("Pi-Agent Core")}</span>
            {piUpdate ? (
              <>
                <strong>v{piUpdate.activeVersion}</strong>
                <small title={piUpdate.error}>
                  {piUpdate.error
                    ? `${t("Update check failed")} · ${t("Bundled")} ${
                        piUpdate.bundledVersion
                      }`
                    : `${t("Bundled")} ${piUpdate.bundledVersion} · ${t(
                        "Latest",
                      )} ${piUpdate.latestVersion}`}
                </small>
              </>
            ) : (
              <>
                <strong>
                  {piChecking ? t("Checking…") : t("Status unavailable")}
                </strong>
                <small>
                  {t("Use Check now to query the official npm release.")}
                </small>
              </>
            )}
          </div>
          {piUpdate?.restartRequired ? (
            <span className="update-state update-state--pending">
              {t("Restart required")}
            </span>
          ) : piUpdate?.updateAvailable ? (
            <button
              className="button button--primary"
              type="button"
              disabled={piInstalling}
              onClick={() => void installCoreUpdate()}
            >
              {piInstalling
                ? t("Installing & preflighting…")
                : t("Install {version}", {
                    version: piUpdate.latestVersion,
                  })}
            </button>
          ) : (
            <button
              className="button button--quiet"
              type="button"
              disabled={piChecking}
              onClick={() => void refreshPiUpdate()}
            >
              {piChecking ? t("Checking…") : t("Check now")}
            </button>
          )}
        </div>
        <div className="update-center__preferences">
          <label className="update-toggle">
            <span>
              <strong>{t("Automatically update Pi-Agent")}</strong>
              <small>
                {t(
                  "Download, verify, and activate a new core before the desktop runtime starts.",
                )}
              </small>
            </span>
            <input
              type="checkbox"
              checked={updatePreferences.autoUpdatePiAgent}
              disabled={preferenceSaving}
              onChange={(event) =>
                void changeUpdatePreference(
                  "autoUpdatePiAgent",
                  event.target.checked,
                )
              }
            />
          </label>
          <label className="update-toggle">
            <span>
              <strong>
                {t("Automatically update installed extensions")}
              </strong>
              <small>
                {t(
                  "Keep info-only scans enabled automatically. Disable and request review when warnings or capabilities change.",
                )}
              </small>
            </span>
            <input
              type="checkbox"
              checked={updatePreferences.autoUpdateExtensions}
              disabled={preferenceSaving}
              onChange={(event) =>
                void changeUpdatePreference(
                  "autoUpdateExtensions",
                  event.target.checked,
                )
              }
            />
          </label>
        </div>
      </section>

      <section className="extension-layout">
        <div className="panel extension-form">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">
                {draft.id ? t("Edit extension") : t("Register local extension")}
              </span>
              <h3>{draft.id ? draft.name : t("Inspect before enabling")}</h3>
            </div>
            {draft.id ? (
              <button className="text-button" type="button" onClick={resetForm}>
                {t("New")}
              </button>
            ) : null}
          </div>

          <label className="field">
            <span>{t("Name")}</span>
            <input
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="My Pi Extension"
            />
          </label>

          <label className="field">
            <span>{t("Local file or directory")}</span>
            <div className="field__row">
              <input
                value={draft.sourcePath}
                onChange={(event) => update("sourcePath", event.target.value)}
                placeholder="/Users/you/pi-extensions/example"
              />
              <button
                className="button button--quiet"
                type="button"
                onClick={() => browse(false)}
                disabled={busy}
              >
                {t("File…")}
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => browse(true)}
                disabled={busy}
              >
                {t("Folder…")}
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={runScan}
                disabled={busy || !draft.sourcePath.trim()}
              >
                {busy ? t("Scanning…") : t("Scan")}
              </button>
            </div>
          </label>

          {scan ? (
            <div className="scan-summary">
              <div className="scan-summary__meta">
                <span>
                  {t("{count} files", { count: scan.scannedFiles })}
                </span>
                <span>{formatBytes(scan.scannedBytes)}</span>
                <span title={scan.contentHash}>
                  SHA-256 {scan.contentHash.slice(0, 10)}
                </span>
              </div>
              <div className="finding-list">
                {scan.findings.map((finding, index) => (
                  <FindingRow
                    finding={finding}
                    key={`${finding.capability}-${finding.file ?? index}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="form-note">
              {t(
                "The scan reads at most 200 source or configuration files and 2 MiB in total. It never executes the extension or package.json scripts. Saving creates an isolated version snapshot; third-party source runs only in a restricted worker through the Capability Broker. Managed mode supports custom tools while hooks, commands, and renderers remain disabled.",
              )}
            </p>
          )}

          <div className="option-row option-row--stack">
            <label className="check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
              />
              {t("Enable for newly created Tasks")}
            </label>
            {elevatedFindings.length ? (
              <label className="check check--danger">
                <input
                  type="checkbox"
                  checked={draft.approved}
                  onChange={(event) => update("approved", event.target.checked)}
                />
                {t(
                  elevatedFindings.length === 1
                    ? "I reviewed and approve {count} elevated finding"
                    : "I reviewed and approve {count} elevated findings",
                  { count: elevatedFindings.length },
                )}
              </label>
            ) : null}
          </div>

          <button
            className="button button--primary button--full"
            type="button"
            onClick={submit}
            disabled={
              busy ||
              !scan ||
              !draft.name.trim() ||
              (draft.enabled && elevatedFindings.length > 0 && !draft.approved)
            }
          >
            {draft.id ? t("Save Extension") : t("Register Extension")}
          </button>
        </div>

        <div className="extension-list">
          {extensions.length === 0 ? (
            <div className="panel extension-empty">
              <span>03</span>
              <h3>{t("No extensions registered")}</h3>
              <p>
                {t(
                  "Register a local Pi Extension to review its capabilities before enabling it for new tasks.",
                )}
              </p>
            </div>
          ) : (
            extensions.map((extension) => {
              const elevated = extension.findings.filter(
                (finding) => finding.severity !== "info",
              ).length;
              const packageUpdate = updates.find(
                (update) => update.id === extension.id,
              );
              return (
                <article className="panel extension-card" key={extension.id}>
                  <div className="extension-card__top">
                    <div>
                      <div className="endpoint-card__name">
                        <h3>{extension.name}</h3>
                        <span>
                          {extension.enabled ? t("Enabled") : t("Disabled")}
                        </span>
                      </div>
                      <p>{extension.sourcePath}</p>
                    </div>
                    <span
                      className={`risk-badge ${
                        elevated ? "risk-badge--elevated" : ""
                      }`}
                    >
                      {elevated
                        ? t("{count} findings", { count: elevated })
                        : t("Reviewed")}
                    </span>
                  </div>
                  <div className="extension-stats">
                    <span>
                      {t("{count} files", {
                        count: extension.scannedFiles,
                      })}
                    </span>
                    <span>{formatBytes(extension.scannedBytes)}</span>
                    <span>SHA {extension.contentHash.slice(0, 8)}</span>
                    <span>
                      {extension.approved
                        ? t("Approved")
                        : t("Not approved")}
                    </span>
                    <span>
                      {t("{count} snapshots", {
                        count: extension.versions.length,
                      })}
                    </span>
                    {extension.packageVersion ? (
                      <span>v{extension.packageVersion}</span>
                    ) : null}
                    {packageUpdate?.updateAvailable ? (
                      <span>
                        {t("Update v{version}", {
                          version: packageUpdate.latestVersion,
                        })}
                      </span>
                    ) : packageUpdate?.error ? (
                      <span title={packageUpdate.error}>
                        {t("Update check failed")}
                      </span>
                    ) : null}
                    <span>{t("Managed Worker")}</span>
                  </div>
                  <details
                    className="security-review"
                    open={pendingApproval === extension.id || undefined}
                  >
                    <summary>
                      {t("Security review")}
                      <span>
                        {elevated
                          ? t("{count} elevated", { count: elevated })
                          : t("No elevated findings")}
                      </span>
                    </summary>
                    <div className="finding-list">
                      {extension.findings.map((finding, index) => (
                        <FindingRow
                          finding={finding}
                          key={`${finding.capability}-${finding.file ?? index}`}
                        />
                      ))}
                    </div>
                  </details>
                  <details className="version-history">
                    <summary>
                      {t("Quarantine versions")}
                      <span>
                        {extension.installPath
                          ? t("Isolated")
                          : t("Review required")}
                      </span>
                    </summary>
                    <div className="version-list">
                      {extension.versions.length ? (
                        extension.versions.map((version) => {
                          const active =
                            version.contentHash === extension.activeVersion;
                          return (
                            <div className="version-row" key={version.contentHash}>
                              <div>
                                <strong>
                                  {version.packageVersion
                                    ? `v${version.packageVersion}`
                                    : version.contentHash.slice(0, 10)}
                                </strong>
                                <span>
                                  {new Date(
                                    version.installedAt,
                                  ).toLocaleString(locale)}
                                </span>
                              </div>
                              <div>
                                <span className={active ? "version-active" : ""}>
                                  {active
                                    ? t("Active")
                                    : version.approved
                                      ? t("Approved")
                                      : t("Scanned")}
                                </span>
                                {!active ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      activateVersion(
                                        extension.id,
                                        version.contentHash,
                                      )
                                    }
                                  >
                                    {t("Use version")}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p>
                          {t(
                            "This legacy profile points directly to a path. Review and save it again to create an isolated snapshot.",
                          )}
                        </p>
                      )}
                    </div>
                  </details>
                  <div className="endpoint-actions">
                    {packageUpdate?.updateAvailable ? (
                      <button
                        type="button"
                        disabled={updating !== null}
                        onClick={() => void updatePackage(extension)}
                      >
                        {updating === extension.id
                          ? t("Updating…")
                          : t("Update to {version}", {
                              version: packageUpdate.latestVersion,
                            })}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => edit(extension)}>
                      {extension.sourceKind === "npm"
                        ? t("Review findings")
                        : t("Edit source")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(extension)}
                    >
                      {extension.enabled
                        ? t("Disable")
                        : pendingApproval === extension.id &&
                            elevated > 0 &&
                            !extension.approved
                          ? t("Confirm enable")
                          : t("Enable")}
                    </button>
                    <button
                      className={
                        pendingDelete === extension.id ? "danger-active" : ""
                      }
                      type="button"
                      onClick={() => remove(extension.id)}
                    >
                      {pendingDelete === extension.id
                        ? t("Confirm Remove")
                        : t("Remove")}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
      </>
      )}

      {error ? (
        <section className="error-banner" role="alert">
          <strong>{t("Extension error")}</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            {t("Dismiss")}
          </button>
        </section>
      ) : null}
    </>
  );
}

function FindingRow({ finding }: { finding: ExtensionFinding }) {
  const { t } = useI18n();

  return (
    <article className={`finding finding--${finding.severity}`}>
      <div>
        <strong>{finding.capability}</strong>
        <span>{t(finding.severity)}</span>
      </div>
      <p>{finding.message}</p>
      {finding.file ? <code>{finding.file}</code> : null}
    </article>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(1)} KiB`;
}

function formatDownloads(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
