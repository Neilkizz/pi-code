import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { PaneLayout } from "./PaneLayout";
import { DEFAULT_PANE_LAYOUT } from "./paneLayoutState";

describe("PaneLayout", () => {
  it("renders chat pane by default", () => {
    render(
      <I18nProvider>
        <PaneLayout
          chatPane={<div data-testid="chat-pane">Chat Stream</div>}
          inspectorPane={<div data-testid="inspector-pane">Review Panel</div>}
          terminalPane={<div data-testid="terminal-pane">PTY Terminal</div>}
          config={{ ...DEFAULT_PANE_LAYOUT, inspectorOpen: true, terminalOpen: false }}
          hasRecord
          onSideWidthChange={vi.fn()}
          onTerminalHeightChange={vi.fn()}
          onPreviewHeightChange={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("chat-pane")).toBeDefined();
    expect(screen.getByTestId("inspector-pane")).toBeDefined();
    expect(screen.queryByTestId("terminal-pane")).toBeNull();
  });

  it("renders vertical resizer when inspector is open", () => {
    render(
      <I18nProvider>
        <PaneLayout
          chatPane={<div>Chat</div>}
          inspectorPane={<div>Inspector</div>}
          config={{ ...DEFAULT_PANE_LAYOUT, inspectorOpen: true }}
          hasRecord
          onSideWidthChange={vi.fn()}
          onTerminalHeightChange={vi.fn()}
          onPreviewHeightChange={vi.fn()}
        />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize side panel" });
    expect(resizer).toBeDefined();
  });

  it("renders horizontal resizer when terminal is open", () => {
    render(
      <I18nProvider>
        <PaneLayout
          chatPane={<div>Chat</div>}
          terminalPane={<div>Terminal</div>}
          config={{ ...DEFAULT_PANE_LAYOUT, inspectorOpen: false, terminalOpen: true }}
          hasRecord
          onSideWidthChange={vi.fn()}
          onTerminalHeightChange={vi.fn()}
          onPreviewHeightChange={vi.fn()}
        />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize terminal" });
    expect(resizer).toBeDefined();
  });

  it("supports keyboard arrow adjustment on vertical resizer", () => {
    const onSideWidthChange = vi.fn();
    render(
      <I18nProvider>
        <PaneLayout
          chatPane={<div>Chat</div>}
          inspectorPane={<div>Inspector</div>}
          config={{ ...DEFAULT_PANE_LAYOUT, inspectorOpen: true, sideWidth: 360 }}
          hasRecord
          onSideWidthChange={onSideWidthChange}
          onTerminalHeightChange={vi.fn()}
          onPreviewHeightChange={vi.fn()}
        />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize side panel" });
    fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(onSideWidthChange).toHaveBeenCalledWith(370);
  });

  it("renders preview pane and its horizontal resizer when preview is open", () => {
    render(
      <I18nProvider>
        <PaneLayout
          chatPane={<div>Chat</div>}
          previewPane={<div data-testid="preview-pane">Preview Frame</div>}
          config={{ ...DEFAULT_PANE_LAYOUT, inspectorOpen: false, previewOpen: true }}
          hasRecord
          onSideWidthChange={vi.fn()}
          onTerminalHeightChange={vi.fn()}
          onPreviewHeightChange={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("preview-pane")).toBeDefined();
    const resizer = screen.getByRole("separator", { name: "Resize preview" });
    expect(resizer).toBeDefined();
  });

  it("supports keyboard arrow adjustment on the preview resizer", () => {
    const onPreviewHeightChange = vi.fn();
    render(
      <I18nProvider>
        <PaneLayout
          chatPane={<div>Chat</div>}
          previewPane={<div>Preview</div>}
          config={{ ...DEFAULT_PANE_LAYOUT, inspectorOpen: false, previewOpen: true }}
          hasRecord
          onSideWidthChange={vi.fn()}
          onTerminalHeightChange={vi.fn()}
          onPreviewHeightChange={onPreviewHeightChange}
        />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize preview" });
    fireEvent.keyDown(resizer, { key: "ArrowUp" });
    expect(onPreviewHeightChange).toHaveBeenCalledWith(270);
  });
});
