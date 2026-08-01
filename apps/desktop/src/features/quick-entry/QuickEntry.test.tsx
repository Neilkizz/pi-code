import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { QuickEntry } from "./QuickEntry";

const { emit, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

const hide = vi.fn();
const setFocus = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide, setFocus }),
}));

function renderQuickEntry() {
  return render(
    <I18nProvider>
      <QuickEntry />
    </I18nProvider>,
  );
}

describe("QuickEntry", () => {
  it("renders the input and action buttons", () => {
    renderQuickEntry();
    expect(screen.getByText("Quick Entry")).toBeDefined();
    expect(screen.getByPlaceholderText("Describe what you want Pi to do…")).toBeDefined();
    expect(screen.getByText("Screenshot")).toBeDefined();
    expect(screen.getByText("Submit")).toBeDefined();
  });

  it("disables submit until a prompt is typed", () => {
    renderQuickEntry();
    const submit = screen.getByText("Submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Describe what you want Pi to do…"), {
      target: { value: "hello" },
    });
    expect(submit.disabled).toBe(false);
  });

  it("emits quick-entry-submit and hides on submit", async () => {
    renderQuickEntry();
    fireEvent.change(screen.getByPlaceholderText("Describe what you want Pi to do…"), {
      target: { value: "scan this screen" },
    });
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith("quick-entry-submit", {
        prompt: "scan this screen",
        captureScreenshot: false,
      });
    });
    expect(hide).toHaveBeenCalled();
  });

  it("toggles the screenshot flag", async () => {
    renderQuickEntry();
    fireEvent.change(screen.getByPlaceholderText("Describe what you want Pi to do…"), {
      target: { value: "capture" },
    });
    fireEvent.click(screen.getByText("Screenshot"));
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith("quick-entry-submit", {
        prompt: "capture",
        captureScreenshot: true,
      });
    });
  });
});
