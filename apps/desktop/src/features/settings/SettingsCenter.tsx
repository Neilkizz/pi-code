import { useEffect, useState } from "react";
import type {
  AgentHostLaunch,
  DesktopBootstrap,
  DesktopHostState,
  EndpointProfile,
} from "@pi-desktop/protocol";
import { NavIcon } from "../../design-system/NavIcon";
import {
  type AppLocale,
  type AppTheme,
  useI18n,
} from "../../i18n/I18nProvider";
import { EndpointCenter } from "../endpoints/EndpointCenter";
import { ExtensionCenter } from "../extensions/ExtensionCenter";

export type SettingsSection =
  | "general"
  | "endpoints"
  | "extensions"
  | "runtime";

interface SettingsCenterProps {
  section: SettingsSection;
  bootstrap: DesktopBootstrap | null;
  host: DesktopHostState;
  hostLaunch: AgentHostLaunch | null;
  onSectionChange: (section: SettingsSection) => void;
  onProfilesChanged: (endpoints: EndpointProfile[]) => void;
  onRestartHost: () => void;
  onClose: () => void;
}

export function SettingsCenter({
  section,
  bootstrap,
  host,
  hostLaunch,
  onSectionChange,
  onProfilesChanged,
  onRestartHost,
  onClose,
}: SettingsCenterProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (label: string) =>
    !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <button
        className="settings-backdrop"
        type="button"
        onClick={onClose}
        aria-label={t("Close settings")}
      />
      <section className="settings-center">
        <nav className="settings-nav" aria-label={t("Settings")}>
          <div className="settings-nav__search">
            <span className="sr-only">{t("Search settings")}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search")}
              aria-label={t("Search settings")}
              autoFocus
            />
          </div>
          <span className="settings-nav__group">{t("Settings")}</span>
        <SettingsNavButton
          active={section === "general"}
          icon="sliders"
          label={t("General")}
          hidden={!matches(t("General"))}
          onClick={() => onSectionChange("general")}
        />
        <SettingsNavButton
          active={section === "endpoints"}
          icon="activity"
          label={t("Models & API")}
          hidden={!matches(t("Models & API"))}
          onClick={() => onSectionChange("endpoints")}
        />
        <SettingsNavButton
          active={section === "extensions"}
          icon="puzzle"
          label={t("Extensions & updates")}
          hidden={!matches(t("Extensions & updates"))}
          onClick={() => onSectionChange("extensions")}
        />
        <SettingsNavButton
          active={section === "runtime"}
          icon="settings"
          label={t("Runtime")}
          hidden={!matches(t("Runtime"))}
          onClick={() => onSectionChange("runtime")}
        />
        </nav>

        <div className="settings-detail">
          <button
            className="settings-close"
            type="button"
            onClick={onClose}
            aria-label={t("Close settings")}
            title={t("Close settings")}
          >
            ×
          </button>
          {section === "endpoints" ? (
            <EndpointCenter onProfilesChanged={onProfilesChanged} />
          ) : section === "extensions" ? (
            <ExtensionCenter />
          ) : section === "runtime" ? (
            <RuntimeSettings
              bootstrap={bootstrap}
              host={host}
              hostLaunch={hostLaunch}
              onRestartHost={onRestartHost}
            />
          ) : (
            <GeneralSettings />
          )}
        </div>
      </section>
    </div>
  );
}

function GeneralSettings() {
  const { locale, setLocale, setTheme, t, theme } = useI18n();

  return (
    <>
      <header className="workspace__header settings-page-header">
        <div>
          <span className="workspace__eyebrow">{t("Settings")}</span>
          <h2>{t("General")}</h2>
          <p className="workspace__description">
            {t("Preferences are saved locally on this Mac.")}
          </p>
        </div>
      </header>

      <div className="settings-card-list">
        <section className="panel preference-card">
          <div>
            <strong>{t("Language")}</strong>
            <span>
              {t(
                "Use the language that feels most natural for directing Pi.",
              )}
            </span>
          </div>
          <select
            value={locale}
            onChange={(event) =>
              setLocale(event.target.value as AppLocale)
            }
            aria-label={t("Language")}
          >
            <option value="zh-CN">{t("Chinese")}</option>
            <option value="en-US">{t("English")}</option>
          </select>
        </section>

        <section className="panel preference-card">
          <div>
            <strong>{t("Appearance")}</strong>
            <span>{t("Preferences are saved locally on this Mac.")}</span>
          </div>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as AppTheme)}
            aria-label={t("Appearance")}
          >
            <option value="system">{t("Follow system")}</option>
            <option value="light">{t("Light")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
        </section>

        <section className="panel preference-card preference-card--stack">
          <div>
            <strong>{t("Local-first workspace")}</strong>
            <span>
              {t(
                "Tasks, endpoint profiles, and extension snapshots stay on this Mac unless an API request explicitly sends task context to your selected provider.",
              )}
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function RuntimeSettings({
  bootstrap,
  host,
  hostLaunch,
  onRestartHost,
}: {
  bootstrap: DesktopBootstrap | null;
  host: DesktopHostState;
  hostLaunch: AgentHostLaunch | null;
  onRestartHost: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <header className="workspace__header settings-page-header">
        <div>
          <span className="workspace__eyebrow">{t("Settings")}</span>
          <h2>{t("Runtime")}</h2>
          <p className="workspace__description">
            {t(
              "Restart the isolated Pi coordinator and reconnect saved sessions.",
            )}
          </p>
        </div>
        <span className={`badge runtime-badge runtime-badge--${host.status}`}>
          {t(statusLabel(host.status))}
        </span>
      </header>

      <div className="settings-card-list">
        <section className="panel runtime-settings-card">
          <div className="runtime-settings-card__title">
            <span className={`status-dot status-dot--${host.status}`} />
            <div>
              <strong>{t("Pi runtime status")}</strong>
              <span>
                SDK {host.version ?? "—"}
                {hostLaunch ? ` · PID ${hostLaunch.pid}` : ""}
              </span>
            </div>
          </div>
          <button
            className="button button--quiet"
            type="button"
            onClick={onRestartHost}
          >
            {t("Restart runtime")}
          </button>
        </section>

        <section className="panel runtime-detail-card">
          <div>
            <span>{t("Application data")}</span>
            <code>{bootstrap?.appDataDir ?? "—"}</code>
          </div>
          <div>
            <span>{t("Schema version")}</span>
            <strong>{bootstrap?.storage.schemaVersion ?? "—"}</strong>
          </div>
          <div>
            <span>{t("Imported records")}</span>
            <strong>{bootstrap?.storage.importedRecords ?? "—"}</strong>
          </div>
        </section>
      </div>
    </>
  );
}

function SettingsNavButton({
  active,
  icon,
  label,
  hidden,
  onClick,
}: {
  active: boolean;
  icon: "sliders" | "activity" | "puzzle" | "settings";
  label: string;
  hidden: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "is-active" : ""}
      type="button"
      hidden={hidden}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <NavIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function statusLabel(status: DesktopHostState["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "starting":
      return "Starting";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
  }
}
