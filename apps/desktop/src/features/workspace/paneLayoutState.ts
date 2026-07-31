import { useCallback, useEffect, useState } from "react";

export type LayoutPreset =
  | "chat-inspector"
  | "chat-terminal"
  | "three-pane"
  | "chat-only"
  | "custom";

export interface PaneLayoutConfig {
  preset: LayoutPreset;
  inspectorOpen: boolean;
  terminalOpen: boolean;
  sideWidth: number;
  terminalHeight: number;
}

export const STORAGE_KEY_PANE_LAYOUT = "pi-desktop.pane-layout-v1";

export const DEFAULT_PANE_LAYOUT: PaneLayoutConfig = {
  preset: "chat-inspector",
  inspectorOpen: true,
  terminalOpen: false,
  sideWidth: 360,
  terminalHeight: 240,
};

export const MIN_SIDE_WIDTH = 260;
export const MAX_SIDE_WIDTH = 640;
export const MIN_TERMINAL_HEIGHT = 140;
export const MAX_TERMINAL_HEIGHT = 500;

export function clampSideWidth(width: number): number {
  return Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, Math.round(width)));
}

export function clampTerminalHeight(height: number): number {
  return Math.min(
    MAX_TERMINAL_HEIGHT,
    Math.max(MIN_TERMINAL_HEIGHT, Math.round(height)),
  );
}

export function loadSavedPaneLayout(): PaneLayoutConfig {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_PANE_LAYOUT;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PANE_LAYOUT);
    if (!raw) return DEFAULT_PANE_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PaneLayoutConfig>;
    return {
      preset:
        parsed.preset &&
        ["chat-inspector", "chat-terminal", "three-pane", "chat-only", "custom"].includes(
          parsed.preset,
        )
          ? parsed.preset
          : DEFAULT_PANE_LAYOUT.preset,
      inspectorOpen: typeof parsed.inspectorOpen === "boolean" ? parsed.inspectorOpen : DEFAULT_PANE_LAYOUT.inspectorOpen,
      terminalOpen: typeof parsed.terminalOpen === "boolean" ? parsed.terminalOpen : DEFAULT_PANE_LAYOUT.terminalOpen,
      sideWidth: typeof parsed.sideWidth === "number" ? clampSideWidth(parsed.sideWidth) : DEFAULT_PANE_LAYOUT.sideWidth,
      terminalHeight: typeof parsed.terminalHeight === "number" ? clampTerminalHeight(parsed.terminalHeight) : DEFAULT_PANE_LAYOUT.terminalHeight,
    };
  } catch {
    return DEFAULT_PANE_LAYOUT;
  }
}

export function savePaneLayout(config: PaneLayoutConfig): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PANE_LAYOUT, JSON.stringify(config));
  } catch {
    // Ignore storage quota or permission errors
  }
}

export function getPresetConfig(preset: LayoutPreset, current: PaneLayoutConfig): PaneLayoutConfig {
  switch (preset) {
    case "chat-inspector":
      return {
        ...current,
        preset: "chat-inspector",
        inspectorOpen: true,
        terminalOpen: false,
      };
    case "chat-terminal":
      return {
        ...current,
        preset: "chat-terminal",
        inspectorOpen: false,
        terminalOpen: true,
      };
    case "three-pane":
      return {
        ...current,
        preset: "three-pane",
        inspectorOpen: true,
        terminalOpen: true,
      };
    case "chat-only":
      return {
        ...current,
        preset: "chat-only",
        inspectorOpen: false,
        terminalOpen: false,
      };
    case "custom":
    default:
      return current;
  }
}

export function usePaneLayoutState() {
  const [config, setConfig] = useState<PaneLayoutConfig>(loadSavedPaneLayout);

  useEffect(() => {
    savePaneLayout(config);
  }, [config]);

  const selectPreset = useCallback((preset: LayoutPreset) => {
    setConfig((prev) => getPresetConfig(preset, prev));
  }, []);

  const toggleInspector = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      preset: "custom",
      inspectorOpen: !prev.inspectorOpen,
    }));
  }, []);

  const toggleTerminal = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      preset: "custom",
      terminalOpen: !prev.terminalOpen,
    }));
  }, []);

  const setSideWidth = useCallback((width: number) => {
    setConfig((prev) => {
      const clamped = clampSideWidth(width);
      if (prev.sideWidth === clamped) return prev;
      return {
        ...prev,
        preset: "custom",
        sideWidth: clamped,
      };
    });
  }, []);

  const setTerminalHeight = useCallback((height: number) => {
    setConfig((prev) => {
      const clamped = clampTerminalHeight(height);
      if (prev.terminalHeight === clamped) return prev;
      return {
        ...prev,
        preset: "custom",
        terminalHeight: clamped,
      };
    });
  }, []);

  const resetLayout = useCallback(() => {
    setConfig(DEFAULT_PANE_LAYOUT);
  }, []);

  return {
    config,
    selectPreset,
    toggleInspector,
    toggleTerminal,
    setSideWidth,
    setTerminalHeight,
    resetLayout,
  };
}
