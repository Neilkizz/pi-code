import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { PreviewPane } from "./PreviewPane";

const {
  startPreview,
  stopPreview,
  getPreviewStatus,
  listenToPreview,
  openPreviewInBrowser,
} = vi.hoisted(() => ({
  startPreview: vi.fn(),
  stopPreview: vi.fn(),
  getPreviewStatus: vi.fn(),
  listenToPreview: vi.fn(),
  openPreviewInBrowser: vi.fn(),
}));

vi.mock("../../platform/tauri/bridge", () => ({
  startPreview,
  stopPreview,
  getPreviewStatus,
  listenToPreview,
  openPreviewInBrowser,
}));

const serverState = {
  taskId: "task-1",
  port: 41234,
  url: "http://127.0.0.1:41234",
  running: true,
};

function renderPreview() {
  return render(
    <I18nProvider>
      <PreviewPane taskId="task-1" onError={() => undefined} />
    </I18nProvider>,
  );
}

describe("PreviewPane", () => {
  it("shows the empty state with a start button when no server is running", async () => {
    getPreviewStatus.mockResolvedValue(null);
    listenToPreview.mockResolvedValue(() => undefined);
    renderPreview();

    expect(await screen.findByText("Start preview")).toBeDefined();
    expect(screen.queryByTitle("Preview")).toBeNull();
  });

  it("starts the preview server and renders the frame URL", async () => {
    getPreviewStatus.mockResolvedValue(null);
    listenToPreview.mockResolvedValue(() => undefined);
    startPreview.mockResolvedValue(serverState);
    renderPreview();

    fireEvent.click(await screen.findByText("Start preview"));
    const frame = (await screen.findByTitle("Preview")) as HTMLIFrameElement;
    expect(startPreview).toHaveBeenCalledWith("task-1");
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1:41234");
  });

  it("renders console log lines and marks >=400 as errors", async () => {
    const listener = vi.fn();
    let captured: ((line: unknown) => void) | undefined;
    listenToPreview.mockImplementation((options: { onLog: (line: unknown) => void }) => {
      captured = options.onLog;
      return Promise.resolve(listener);
    });
    getPreviewStatus.mockResolvedValue(serverState);
    renderPreview();

    await waitFor(() => expect(captured).toBeDefined());
    captured?.({
      taskId: "task-1",
      method: "GET",
      path: "index.html",
      status: 200,
      bytes: 42,
      mime: "text/html",
    });
    captured?.({
      taskId: "task-1",
      method: "GET",
      path: "missing.png",
      status: 404,
      bytes: 0,
      mime: "text/plain",
    });

    expect(await screen.findByText("index.html")).toBeDefined();
    const errorLine = screen.getByText("missing.png").closest(".preview-console__line");
    expect(errorLine?.className).toContain("preview-console__line--error");
  });

  it("clears the console log", async () => {
    let captured: ((line: unknown) => void) | undefined;
    listenToPreview.mockImplementation((options: { onLog: (line: unknown) => void }) => {
      captured = options.onLog;
      return Promise.resolve(() => undefined);
    });
    getPreviewStatus.mockResolvedValue(null);
    renderPreview();

    await waitFor(() => expect(captured).toBeDefined());
    captured?.({
      taskId: "task-1",
      method: "GET",
      path: "logo.png",
      status: 200,
      bytes: 1024,
      mime: "image/png",
    });
    expect(await screen.findByText("logo.png")).toBeDefined();

    fireEvent.click(screen.getByText("Clear log"));
    expect(screen.queryByText("logo.png")).toBeNull();
    expect(screen.getByText("No requests yet.")).toBeDefined();
  });

  it("stops the preview server when Stop is clicked", async () => {
    listenToPreview.mockResolvedValue(() => undefined);
    getPreviewStatus.mockResolvedValue(serverState);
    stopPreview.mockResolvedValue(undefined);
    renderPreview();

    fireEvent.click(await screen.findByText("Stop preview"));
    expect(stopPreview).toHaveBeenCalledWith("task-1");
  });

  it("opens the preview URL in the system browser", async () => {
    listenToPreview.mockResolvedValue(() => undefined);
    getPreviewStatus.mockResolvedValue(serverState);
    openPreviewInBrowser.mockResolvedValue(undefined);
    renderPreview();

    fireEvent.click(await screen.findByText("Open in browser"));
    expect(openPreviewInBrowser).toHaveBeenCalledWith("http://127.0.0.1:41234");
  });
});
