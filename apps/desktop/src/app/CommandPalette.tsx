import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

export interface CommandPaletteAction {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  actions: CommandPaletteAction[];
  onClose: () => void;
}

export function CommandPalette({
  open,
  actions,
  onClose,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleActions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) =>
      [action.label, action.detail, ...(action.keywords ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(visibleActions.length - 1, 0)),
    );
  }, [visibleActions.length]);

  if (!open) return null;

  function run(action: CommandPaletteAction | undefined): void {
    if (!action || action.disabled) return;
    onClose();
    action.run();
  }

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("Command palette")}
      >
        <label className="command-palette__search">
          <span aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  Math.min(current + 1, visibleActions.length - 1),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(visibleActions[activeIndex]);
              }
            }}
            placeholder={t("Type a command or search…")}
            aria-label={t("Search commands")}
          />
          <kbd>esc</kbd>
        </label>
        <div className="command-palette__list" role="listbox">
          {visibleActions.map((action, index) => (
            <button
              className={index === activeIndex ? "is-active" : ""}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              disabled={action.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(action)}
              key={action.id}
            >
              <span>
                <strong>{action.label}</strong>
                <small>{action.detail}</small>
              </span>
              {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
            </button>
          ))}
          {visibleActions.length === 0 ? (
            <div className="command-palette__empty">
              {t("No matching command")}
            </div>
          ) : null}
        </div>
        <footer>
          <span>{t("↑↓ Navigate")}</span>
          <span>{t("↵ Run")}</span>
          <span>{t("esc Close")}</span>
        </footer>
      </section>
    </div>
  );
}
