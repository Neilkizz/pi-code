import { useEffect, useRef } from "react";

export interface MentionCandidate {
  id: string;
  name: string;
  path?: string;
  kind?: "file" | "folder" | "symbol";
}

interface MentionsAutocompleteProps {
  query: string;
  candidates: MentionCandidate[];
  selectedIndex: number;
  onSelect: (item: MentionCandidate) => void;
}

export function MentionsAutocomplete({
  query,
  candidates,
  selectedIndex,
  onSelect,
}: MentionsAutocompleteProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = candidates.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()) ||
    (item.path && item.path.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl && typeof selectedEl.scrollIntoView === "function") {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (filtered.length === 0) {
    return (
      <div className="mentions-autocomplete mentions-autocomplete--empty" role="listbox">
        <div className="mentions-autocomplete__empty-text">No matching files or symbols</div>
      </div>
    );
  }

  return (
    <div className="mentions-autocomplete" role="listbox" tabIndex={-1}>
      <ul ref={listRef} className="mentions-autocomplete__list">
        {filtered.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <li
              key={item.id}
              role="option"
              aria-selected={isSelected}
              className={`mentions-autocomplete__item ${
                isSelected ? "mentions-autocomplete__item--selected" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent losing focus on textarea
                onSelect(item);
              }}
            >
              <span className="mentions-autocomplete__icon">
                {item.kind === "folder" ? "📁" : item.kind === "symbol" ? "⚡" : "📄"}
              </span>
              <div className="mentions-autocomplete__info">
                <span className="mentions-autocomplete__name">{item.name}</span>
                {item.path ? (
                  <span className="mentions-autocomplete__path">{item.path}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
