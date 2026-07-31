import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { WorkspaceView } from "./routes";

export type { WorkspaceView } from "./routes";

interface AppShellProps {
  activeView: WorkspaceView;
  sidebar: ReactNode;
  commandPalette: ReactNode;
  children: ReactNode;
  error: string | null;
  onDismissError: () => void;
}

export function AppShell({
  activeView,
  sidebar,
  commandPalette,
  children,
  error,
  onDismissError,
}: AppShellProps) {
  const { t } = useI18n();

  return (
    <div className="shell">
      {sidebar}
      <main className={`workspace workspace--${activeView}`}>
        {children}
        {error ? (
          <section className="error-banner" role="alert">
            <strong>{t("Runtime error")}</strong>
            <span>{error}</span>
            <button type="button" onClick={onDismissError}>
              {t("Dismiss")}
            </button>
          </section>
        ) : null}
      </main>
      {commandPalette}
    </div>
  );
}
