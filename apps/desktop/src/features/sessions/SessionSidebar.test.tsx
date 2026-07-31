import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import type { PersistedTask } from "@pi-desktop/protocol";
import { I18nProvider } from "../../i18n/I18nProvider";
import { SessionSidebar } from "./SessionSidebar";

const { renameTask, pinTask, searchTasks, archiveTask, listTasks } =
  vi.hoisted(() => ({
    renameTask: vi.fn(),
    pinTask: vi.fn(),
    searchTasks: vi.fn(),
    archiveTask: vi.fn(),
    listTasks: vi.fn(),
  }));

vi.mock("../../platform/tauri/bridge", () => ({
  renameTask,
  pinTask,
  searchTasks,
  archiveTask,
  listTasks,
}));

listTasks.mockResolvedValue([]);

const task: PersistedTask = {
  id: "t1",
  title: "Fix desktop send",
  cwd: "/work/pi",
  projectRoot: "/work/pi",
  isolation: "worktree",
  worktree: {
    repositoryRoot: "/work/pi",
    worktreePath: "/tmp/pi",
    branch: "pi/fix-send",
    baseline: "abc",
  },
  profile: { permissionMode: "ask" },
  archived: false,
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 2,
};

const pinnedTask: PersistedTask = { ...task, id: "t2", pinned: true };

function renderSidebar(tasks: PersistedTask[]) {
  return render(
    <I18nProvider>
      <SessionSidebar
        activeView="tasks"
        activeTaskId={null}
        tasks={tasks}
        runtimeTasks={[]}
        host={{ status: "idle", runtime: "pi-agent-host", version: undefined }}
        hostLaunch={null}
        onViewChange={vi.fn()}
        onNewTask={vi.fn()}
        onSelectTask={vi.fn()}
        onRestartHost={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onTasksChanged={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("SessionSidebar", () => {
  it("renders task list", () => {
    renderSidebar([task]);
    expect(screen.getByText("Fix desktop send")).toBeTruthy();
  });

  it("shows pin indicator for pinned tasks", () => {
    renderSidebar([pinnedTask]);
    expect(screen.getByLabelText("Pinned")).toBeTruthy();
  });

  it("opens context menu with rename, pin, archive actions", () => {
    renderSidebar([task]);
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(screen.getByText("Pin")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
  });

  it("renames a task inline and confirms", async () => {
    renameTask.mockResolvedValue({ ...task, title: "New title" });
    renderSidebar([task]);
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Rename"));

    const input = screen.getByDisplayValue("Fix desktop send");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(renameTask).toHaveBeenCalledWith("t1", "New title");
    });
  });

  it("pins a task from the context menu", async () => {
    pinTask.mockResolvedValue({ ...task, pinned: true });
    renderSidebar([task]);
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Pin"));

    await waitFor(() => {
      expect(pinTask).toHaveBeenCalledWith("t1", true);
    });
  });

  it("archives a task from the context menu", async () => {
    archiveTask.mockResolvedValue({ ...task, archived: true });
    renderSidebar([task]);
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Archive"));

    await waitFor(() => {
      expect(archiveTask).toHaveBeenCalledWith("t1", true);
    });
  });

  it("searches tasks from the backend after debounce", async () => {
    searchTasks.mockResolvedValue([task]);
    renderSidebar([task]);
    const input = screen.getByPlaceholderText("Search tasks");
    fireEvent.change(input, { target: { value: "send" } });

    await waitFor(
      () => {
        expect(searchTasks).toHaveBeenCalledWith("send");
      },
      { timeout: 1000 },
    );
  });

  it("opens the trash view", async () => {
    renderSidebar([task]);
    fireEvent.click(screen.getByText("Trash"));
    await waitFor(() => {
      expect(screen.getByText("No archived sessions")).toBeTruthy();
    });
  });
});
