import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { TaskViewState } from "../sessions/types";
import { writeTimelineDensity } from "../flags";
import { Timeline } from "./Timeline";

const scrollTo = vi.fn();

const baseView: TaskViewState = {
  restored: false,
  activities: [],
  treeLoading: false,
  queuedPrompts: [],
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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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

  it("applies the default comfortable density class", () => {
    renderTimeline();
    const transcript = document.querySelector(".transcript");
    expect(transcript?.classList.contains("transcript--density-comfortable")).toBe(true);
  });

  it("applies a persisted density class from localStorage", () => {
    window.localStorage.setItem("pi-desktop.timelineDensity", "compact");
    renderTimeline();
    const transcript = document.querySelector(".transcript");
    expect(transcript?.classList.contains("transcript--density-compact")).toBe(true);
  });

  it("reacts to a density change written from settings", async () => {
    renderTimeline();
    const transcript = document.querySelector(".transcript");
    expect(transcript?.classList.contains("transcript--density-comfortable")).toBe(true);

    writeTimelineDensity("spaced");
    await waitFor(() => {
      expect(transcript?.classList.contains("transcript--density-spaced")).toBe(true);
    });
  });

  it("renders only the visible slice of the conversation when virtualized", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `m-${i}`,
      role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
      text: `Message ${i}`,
    }));
    const view = renderTimeline({ ...baseView, messages: many });
    const conversation = view.container.querySelector<HTMLElement>(".conversation")!;
    defineScrollMetrics(conversation, { scrollTop: 0, clientHeight: 600, scrollHeight: 30000 });
    fireEvent.scroll(conversation);

    await waitFor(() => {
      expect(conversation.querySelectorAll(".message").length).toBeLessThan(30);
      expect(conversation.querySelectorAll(".timeline-spacer").length).toBeGreaterThan(0);
    });
  });

  it("keeps the DOM bounded for a 10,000-message conversation", async () => {
    const huge = Array.from({ length: 10000 }, (_, i) => ({
      id: `h-${i}`,
      role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
      text: `Long message number ${i}`,
    }));
    const view = renderTimeline({ ...baseView, messages: huge });
    const conversation = view.container.querySelector<HTMLElement>(".conversation")!;
    defineScrollMetrics(conversation, { scrollTop: 500000, clientHeight: 600, scrollHeight: 1200000 });
    fireEvent.scroll(conversation);

    await waitFor(() => {
      expect(conversation.querySelectorAll(".message").length).toBeLessThan(30);
    });
  });

  it("falls back to the static renderer when virtualization is disabled", async () => {
    window.localStorage.setItem("pi-desktop.flag.timeline.virtualization", "0");
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `m-${i}`,
      role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
      text: `Message ${i}`,
    }));
    const view = renderTimeline({ ...baseView, messages: many });
    const conversation = view.container.querySelector<HTMLElement>(".conversation")!;
    defineScrollMetrics(conversation, { scrollTop: 0, clientHeight: 600, scrollHeight: 10000 });
    fireEvent.scroll(conversation);

    await waitFor(() => {
      expect(conversation.querySelectorAll(".message").length).toBe(50);
      expect(conversation.querySelectorAll(".timeline-spacer").length).toBe(0);
    });
  });

  it("renders compaction and branch summaries as timeline markers", () => {
    const view = {
      ...baseView,
      messages: [
        { id: "c1", role: "compactionSummary" as const, text: "Earlier context summarized.", createdAt: 1000 },
        { id: "b1", role: "branchSummary" as const, text: "Branched to fix a bug.", label: "fix", createdAt: 2000 },
      ],
    };
    renderTimeline(view);

    expect(screen.getByText("Context compacted")).toBeDefined();
    expect(screen.getByText("Earlier context summarized.")).toBeDefined();
    expect(screen.getByText(/Branch here/)).toBeDefined();
    expect(screen.getByText("Branched to fix a bug.")).toBeDefined();
    expect(screen.getByText(/· fix$/)).toBeDefined();
    expect(screen.queryAllByRole("article").length).toBe(0);
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
