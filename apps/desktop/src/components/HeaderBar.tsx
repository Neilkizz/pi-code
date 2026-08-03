import React from "react";

export interface HeaderBarProps {
  title?: string;
  selectedModel?: string;
  activeWorkspace?: string;
  onOpenSettings?: () => void;
  onSelectModel?: (model: string) => void;
  models?: string[];
}

export function HeaderBar({
  title = "Pi Desktop",
  selectedModel,
  activeWorkspace,
  onOpenSettings,
  onSelectModel,
  models,
}: HeaderBarProps) {
  return (
    <header className="header-bar" data-tauri-drag-region>
      <div className="header-bar__title-region" data-tauri-drag-region>
        <span className="header-bar__brand-icon" aria-hidden="true">
          π
        </span>
        <h1 className="header-bar__title" data-tauri-drag-region>
          {title}
        </h1>
      </div>

      <div className="header-bar__center" data-tauri-drag-region>
        {activeWorkspace ? (
          <span className="header-bar__workspace" title={activeWorkspace}>
            <span className="header-bar__workspace-icon" aria-hidden="true">
              📁
            </span>
            <span>{activeWorkspace}</span>
          </span>
        ) : null}
        {selectedModel ? (
          <div className="header-bar__model-badge" role="status">
            <span className="header-bar__model-dot" aria-hidden="true" />
            <span className="header-bar__model-name">{selectedModel}</span>
          </div>
        ) : null}
      </div>

      <div className="header-bar__actions">
        {onOpenSettings ? (
          <button
            type="button"
            className="header-bar__settings-button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
        ) : null}
      </div>
    </header>
  );
}
