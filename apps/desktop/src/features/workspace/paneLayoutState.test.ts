import { describe, expect, it, beforeEach } from "vitest";
import {
  clampPreviewHeight,
  clampSideWidth,
  clampTerminalHeight,
  DEFAULT_PANE_LAYOUT,
  getPresetConfig,
  loadSavedPaneLayout,
  savePaneLayout,
  STORAGE_KEY_PANE_LAYOUT,
  type PaneLayoutConfig,
} from "./paneLayoutState";

describe("paneLayoutState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("clamps side width within bounds [260, 640]", () => {
    expect(clampSideWidth(200)).toBe(260);
    expect(clampSideWidth(300)).toBe(300);
    expect(clampSideWidth(700)).toBe(640);
  });

  it("clamps terminal height within bounds [140, 500]", () => {
    expect(clampTerminalHeight(100)).toBe(140);
    expect(clampTerminalHeight(200)).toBe(200);
    expect(clampTerminalHeight(600)).toBe(500);
  });

  it("clamps preview height within bounds [160, 600]", () => {
    expect(clampPreviewHeight(100)).toBe(160);
    expect(clampPreviewHeight(260)).toBe(260);
    expect(clampPreviewHeight(700)).toBe(600);
  });

  it("loads default pane layout when localStorage is empty", () => {
    const loaded = loadSavedPaneLayout();
    expect(loaded).toEqual(DEFAULT_PANE_LAYOUT);
  });

  it("saves and loads pane layout configuration from localStorage", () => {
    const config: PaneLayoutConfig = {
      preset: "three-pane",
      inspectorOpen: true,
      terminalOpen: true,
      previewOpen: true,
      sideWidth: 400,
      terminalHeight: 300,
      previewHeight: 280,
    };
    savePaneLayout(config);

    const raw = window.localStorage.getItem(STORAGE_KEY_PANE_LAYOUT);
    expect(raw).not.toBeNull();

    const loaded = loadSavedPaneLayout();
    expect(loaded).toEqual(config);
  });

  it("defaults missing preview fields when loading an older layout", () => {
    window.localStorage.setItem(
      STORAGE_KEY_PANE_LAYOUT,
      JSON.stringify({
        preset: "chat-inspector",
        inspectorOpen: true,
        terminalOpen: false,
        sideWidth: 360,
        terminalHeight: 240,
      }),
    );
    const loaded = loadSavedPaneLayout();
    expect(loaded.previewOpen).toBe(false);
    expect(loaded.previewHeight).toBe(DEFAULT_PANE_LAYOUT.previewHeight);
  });

  it("generates correct configuration for standard layout presets", () => {
    const current = DEFAULT_PANE_LAYOUT;

    const chatInspector = getPresetConfig("chat-inspector", current);
    expect(chatInspector.inspectorOpen).toBe(true);
    expect(chatInspector.terminalOpen).toBe(false);

    const chatTerminal = getPresetConfig("chat-terminal", current);
    expect(chatTerminal.inspectorOpen).toBe(false);
    expect(chatTerminal.terminalOpen).toBe(true);

    const threePane = getPresetConfig("three-pane", current);
    expect(threePane.inspectorOpen).toBe(true);
    expect(threePane.terminalOpen).toBe(true);

    const chatOnly = getPresetConfig("chat-only", current);
    expect(chatOnly.inspectorOpen).toBe(false);
    expect(chatOnly.terminalOpen).toBe(false);
  });
});
