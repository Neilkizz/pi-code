import React, { useCallback, useState } from "react";

/**
 * MentionsAutocomplete — shown when the user types `@` in the input.
 * Offers a list of files, symbols, and selections. The extension host
 * sends available paths (paths from workspace + open editors) via a
 * state-like postMessage; this component filters client-side.
 */
interface Props {
  filter: string; // text typed after `@`
  suggestions: string[]; // paths / symbol names from the host
  onPick: (value: string) => void;
  onClose: () => void;
}

export function MentionsAutocomplete({ filter, suggestions, onPick, onClose }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const trimmed = filter.toLowerCase();
  const items = suggestions
    .filter((s) => s.toLowerCase().includes(trimmed))
    .slice(0, 10);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && items.length > 0) {
        onPick(items[selectedIdx]);
      }
    },
    [items, selectedIdx, onPick, onClose],
  );

  if (items.length === 0) {
    return (
      <div className="autocomplete-popup" onKeyDown={handleKey}>
        <div className="autocomplete-item" style={{ color: "var(--text-muted)" }}>
          No matching files
        </div>
      </div>
    );
  }

  return (
    <div className="autocomplete-popup" onKeyDown={handleKey}>
      {items.map((item, idx) => (
        <div
          key={item}
          className={`autocomplete-item${idx === selectedIdx ? " selected" : ""}`}
          onClick={() => onPick(item)}
        >
          <span>{item}</span>
          <span className="path">{item}</span>
        </div>
      ))}
    </div>
  );
}