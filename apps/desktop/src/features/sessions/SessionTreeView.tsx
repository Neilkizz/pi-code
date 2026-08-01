import { useMemo } from "react";
import type { SessionTree, SessionTreeEntry } from "@pi-desktop/protocol";
import { useI18n } from "../../i18n/I18nProvider";

interface SessionTreeViewProps {
  tree: SessionTree | null;
  loading: boolean;
  onRefresh: () => void;
}

export function SessionTreeView({
  tree,
  loading,
  onRefresh,
}: SessionTreeViewProps) {
  const { t } = useI18n();
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, SessionTreeEntry[]>();
    if (tree) {
      for (const entry of tree.entries) {
        const parent = entry.parentEntryId ?? null;
        const siblings = map.get(parent) ?? [];
        siblings.push(entry);
        map.set(parent, siblings);
      }
    }
    return map;
  }, [tree]);

  function renderEntry(entry: SessionTreeEntry, depth: number) {
    const children = childrenOf.get(entry.entryId) ?? [];
    return (
      <div className="session-tree__node" key={entry.entryId}>
        <div
          className={`session-tree__row ${
            entry.current ? "session-tree__row--current" : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <span className="session-tree__type" aria-hidden="true">
            {entryTypeGlyph(entry.type)}
          </span>
          {entry.label ? (
            <span className="session-tree__label" title={entry.label}>
              {entry.label}
            </span>
          ) : null}
          {entry.text ? (
            <span className="session-tree__text" title={entry.text}>
              {entry.text}
            </span>
          ) : (
            <span className="session-tree__type-name">
              {entryTypeName(entry.type)}
            </span>
          )}
          {entry.current ? (
            <span className="session-tree__badge">{t("Current")}</span>
          ) : null}
        </div>
        {children.length > 0 ? (
          <div className="session-tree__children">
            {children.map((child) => renderEntry(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="session-tree__state">
        {t("Loading session tree…")}
      </div>
    );
  }
  if (!tree || tree.entries.length === 0) {
    return (
      <div className="session-tree__state">
        <p>{t("No session tree yet.")}</p>
        <button type="button" className="session-tree__refresh" onClick={onRefresh}>
          {t("Refresh")}
        </button>
      </div>
    );
  }
  const roots = childrenOf.get(null) ?? [];
  return (
    <div className="session-tree">
      <div className="session-tree__head">
        <span>{t("Session tree")}</span>
        <button type="button" className="session-tree__refresh" onClick={onRefresh}>
          {t("Refresh")}
        </button>
      </div>
      <div className="session-tree__body">
        {roots.map((root) => renderEntry(root, 0))}
      </div>
    </div>
  );
}

function entryTypeGlyph(type: string): string {
  switch (type) {
    case "message":
      return "✦";
    case "compaction":
      return "◎";
    case "branch_summary":
      return "⑂";
    case "session":
      return "●";
    default:
      return "·";
  }
}

function entryTypeName(type: string): string {
  switch (type) {
    case "message":
      return "message";
    case "compaction":
      return "compaction";
    case "branch_summary":
      return "branch";
    default:
      return type;
  }
}
