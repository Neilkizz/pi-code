import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionTree } from "@pi-desktop/protocol";
import { I18nProvider } from "../../i18n/I18nProvider";
import { SessionTreeView } from "./SessionTreeView";

const tree: SessionTree = {
  taskId: "task-1",
  leafId: "e3",
  entries: [
    { entryId: "e0", parentEntryId: null, type: "session", current: true },
    {
      entryId: "e1",
      parentEntryId: "e0",
      type: "message",
      text: "first message",
      current: false,
    },
    {
      entryId: "e2",
      parentEntryId: "e0",
      type: "compaction",
      text: "Summarized earlier.",
      current: true,
    },
    {
      entryId: "e3",
      parentEntryId: "e2",
      type: "message",
      text: "after compact",
      current: true,
    },
  ],
};

function renderTree(props: {
  tree?: SessionTree | null;
  loading?: boolean;
  onRefresh?: () => void;
} = {}) {
  return render(
    <I18nProvider>
      <SessionTreeView
        tree={props.tree ?? null}
        loading={props.loading ?? false}
        onRefresh={props.onRefresh ?? (() => undefined)}
      />
    </I18nProvider>,
  );
}

describe("SessionTreeView", () => {
  it("renders every entry with current rows highlighted", () => {
    renderTree({ tree });
    expect(screen.getByText("first message")).toBeDefined();
    expect(screen.getByText("Summarized earlier.")).toBeDefined();
    expect(screen.getByText("after compact")).toBeDefined();
    const currentRows = document.querySelectorAll(
      ".session-tree__row--current",
    );
    expect(currentRows.length).toBe(3);
  });

  it("marks the current leaf path with a badge", () => {
    renderTree({ tree });
    expect(screen.getAllByText("Current").length).toBe(3);
  });

  it("shows a loading state", () => {
    renderTree({ loading: true });
    expect(screen.getByText("Loading session tree…")).toBeDefined();
  });

  it("shows an empty state and refresh triggers onRefresh", () => {
    const onRefresh = vi.fn();
    renderTree({ tree: null, onRefresh });
    expect(screen.getByText("No session tree yet.")).toBeDefined();
    fireEvent.click(screen.getByText("Refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
