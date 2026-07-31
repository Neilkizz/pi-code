import { describe, expect, it } from "vitest";
import type { PersistedTask } from "@pi-desktop/protocol";
import { filterTasks } from "./presentation";

const tasks: PersistedTask[] = [
  { id: "1", title: "Fix desktop send", cwd: "/work/pi", projectRoot: "/work/pi", isolation: "worktree", worktree: { repositoryRoot: "/work/pi", worktreePath: "/tmp/pi", branch: "pi/fix-send", baseline: "abc" }, profile: { permissionMode: "ask" }, archived: false, pinned: false, createdAt: 1, updatedAt: 1, lastOpenedAt: 2 },
  { id: "2", title: "Draft report", cwd: "/work/docs", projectRoot: "/work/docs", isolation: "currentCheckout", profile: { permissionMode: "plan" }, archived: false, pinned: false, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 },
];

describe("filterTasks", () => {
  it("matches task title, project path and worktree branch", () => {
    expect(filterTasks(tasks, "send").map((task) => task.id)).toEqual(["1"]);
    expect(filterTasks(tasks, "docs").map((task) => task.id)).toEqual(["2"]);
    expect(filterTasks(tasks, "fix-send").map((task) => task.id)).toEqual(["1"]);
  });
});
