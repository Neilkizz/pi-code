import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { TaskViewState } from "../sessions/types";
import { Timeline } from "./Timeline";

const scrollTo = vi.fn();

const baseView: TaskViewState = {
  restored: false,
  activities: [],
  messages: [
    { id: "user-1", role: "user", text: "Inspect this project" },
    { id: "assistant-1", role: "assistant", text: "I am checking it." },
  ],
};

function renderTimeline(taskView = baseView, taskError?: string) {
  return render(
    <I18nProvider>
      <div className="conversation">
        <Timeline
          hasTask
          taskView={taskView}
          taskConnected
          taskRunning={false}
          taskError={taskError}
          showActivity
        />
      </div>
    </I18nProvider>,
  );
}

describe("Timeline", () => {
  beforeEach(() => {
    scrollTo.mockReset();
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows new output while the reader is already at the bottom", () => {
    const view = renderTimeline();
    const conversation = view.container.querySelector<HTMLElement>(".conversation");
    expect(conversation).not.toBeNull();
    defineScrollMetrics(conversation!, { scrollTop: 400, clientHeight: 300, scrollHeight: 700 });
    fireEvent.scroll(conversation!);
    scrollTo.mockClear();

    view.rerender(
      <I18nProvider>
        <div className="conversation">
          <Timeline
            hasTask
            taskView={{
              ...baseView,
              messages: [
                ...baseView.messages,
                { id: "assistant-2", role: "assistant", text: "Latest response" },
              ],
            }}
            taskConnected
            taskRunning={false}
            showActivity
          />
        </div>
      </I18nProvider>,
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "auto" });
  });

  it("does not pull the reader away from earlier messages", () => {
    const view = renderTimeline();
    const conversation = view.container.querySelector<HTMLElement>(".conversation");
    expect(conversation).not.toBeNull();
    defineScrollMetrics(conversation!, { scrollTop: 20, clientHeight: 300, scrollHeight: 900 });
    fireEvent.scroll(conversation!);
    scrollTo.mockClear();

    view.rerender(
      <I18nProvider>
        <div className="conversation">
          <Timeline
            hasTask
            taskView={{
              ...baseView,
              messages: [
                ...baseView.messages,
                { id: "assistant-2", role: "assistant", text: "Latest response" },
              ],
            }}
            taskConnected
            taskRunning={false}
            showActivity
          />
        </div>
      </I18nProvider>,
    );

    expect(scrollTo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Jump to latest|回到最新消息/ }),
    ).toBeTruthy();
  });

  it("shows expandable inputs and outputs for tool activity", () => {
    renderTimeline({
      ...baseView,
      activities: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Tool completed · read",
          input: '{"path":"README.md"}',
          output: '{"content":"ok"}',
          status: "completed",
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      ],
    });

    expect(screen.getByText("Tool completed · read")).toBeTruthy();
    expect(screen.getByText(/Input|输入/)).toBeTruthy();
    expect(screen.getByText(/Output|输出/)).toBeTruthy();
  });

  it("binds a pre-response runtime failure to the empty assistant turn", () => {
    renderTimeline(
      {
        ...baseView,
        messages: [
          ...baseView.messages,
          { id: "assistant-pending", role: "assistant", text: "" },
        ],
        streamingAssistantId: "assistant-pending",
      },
      "No API key found for the selected model.",
    );

    expect(screen.getByText(/Pi stopped before responding|Pi 在回复前已停止/)).toBeTruthy();
    expect(screen.getByText("No API key found for the selected model.")).toBeTruthy();
  });
});

function defineScrollMetrics(
  element: HTMLElement,
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
): void {
  for (const [name, value] of Object.entries(metrics)) {
    Object.defineProperty(element, name, { configurable: true, value, writable: true });
  }
}
