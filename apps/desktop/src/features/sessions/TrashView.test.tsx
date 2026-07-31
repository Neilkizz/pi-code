import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import type { PersistedTask } from "@pi-desktop/protocol";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TrashView } from "./TrashView";

const { listTasks, archiveTask, deleteTask } = vi.hoisted(() => ({
  listTasks: vi.fn(),
  archiveTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock("../../platform/tauri/bridge", () => ({
  listTasks,
  archiveTask,
  deleteTask,
}));

const archived: PersistedTask = {
  id: "archived-1",
  title: "Old session",
  cwd: "/work/old",
  projectRoot: "/work",
  isolation: "worktree",
  worktree: {
    repositoryRoot: "/work",
    worktreePath: "/tmp/wt",
    branch: "pi/old",
    baseline: "abc",
  },
  profile: { permissionMode: "ask" },
  archived: true,
  pinned: false,
  createdAt: 1000,
  updatedAt: 2000,
  lastOpenedAt: 3000,
};

const active: PersistedTask = {
  id: "active-1",
  title: "Live session",
  cwd: "/work/now",
  projectRoot: "/work",
  isolation: "currentCheckout",
  profile: { permissionMode: "ask" },
  archived: false,
  pinned: false,
  createdAt: 1000,
  updatedAt: 2000,
  lastOpenedAt: 3000,
};

function renderTrash() {
  return render(
    <I18nProvider>
      <TrashView onClose={vi.fn()} />
    </I18nProvider>,
  );
}

describe("TrashView", () => {
  it("lists only archived sessions", async () => {
    listTasks.mockResolvedValue([archived, active]);
    renderTrash();

    await waitFor(() => {
      expect(screen.getByText("Old session")).toBeTruthy();
    });
    expect(screen.queryByText("Live session")).toBeNull();
  });

  it("shows empty message when no archived sessions", async () => {
    listTasks.mockResolvedValue([active]);
    renderTrash();

    await waitFor(() => {
      expect(screen.getByText("No archived sessions")).toBeTruthy();
    });
  });

  it("restores a session and removes it from the list", async () => {
    listTasks.mockResolvedValue([archived]);
    archiveTask.mockResolvedValue({ ...archived, archived: false });
    renderTrash();

    await waitFor(() => {
      expect(screen.getByText("Old session")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => {
      expect(archiveTask).toHaveBeenCalledWith("archived-1", false);
    });
    expect(screen.queryByText("Old session")).toBeNull();
  });

  it("confirms before permanent delete", async () => {
    listTasks.mockResolvedValue([archived]);
    deleteTask.mockResolvedValue(undefined);
    renderTrash();

    await waitFor(() => {
      expect(screen.getByText("Old session")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Delete permanently"));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Are you sure you want to permanently delete this session?",
        ),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("Delete permanently")[1]);
    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith("archived-1");
    });
    expect(screen.queryByText("Old session")).toBeNull();
  });

  it("cancels permanent delete when dismissed", async () => {
    listTasks.mockResolvedValue([archived]);
    renderTrash();

    await waitFor(() => {
      expect(screen.getByText("Old session")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Delete permanently"));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Are you sure you want to permanently delete this session?",
        ),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Are you sure you want to permanently delete this session?",
        ),
      ).toBeNull();
    });
    expect(screen.getByText("Old session")).toBeTruthy();
  });
});
