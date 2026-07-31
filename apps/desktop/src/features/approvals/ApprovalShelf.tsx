import type { TaskPermissionRequest } from "@pi-desktop/protocol";
import { useI18n } from "../../i18n/I18nProvider";
import { compactJson } from "../sessions/presentation";

interface ApprovalShelfProps {
  requests: TaskPermissionRequest[];
  onResolve: (request: TaskPermissionRequest, approved: boolean) => void;
}

export function ApprovalShelf({
  requests,
  onResolve,
}: ApprovalShelfProps) {
  const { t } = useI18n();

  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="permission-stack" aria-live="assertive">
      {requests.map((request) => (
        <section className="permission-card" key={request.id} role="alert">
          <div className="permission-card__header">
            <div>
              <span>{t("Tool approval")}</span>
              <strong>{request.toolName}</strong>
            </div>
            <span>{t("Waiting")}</span>
          </div>
          <pre>{compactJson(request.input)}</pre>
          <div className="permission-card__actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={() => onResolve(request, false)}
            >
              {t("Deny")}
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onResolve(request, true)}
            >
              {t("Allow once")}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
