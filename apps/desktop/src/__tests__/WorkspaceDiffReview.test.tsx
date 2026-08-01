import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import type {
  PersistedTask,
  WorkspaceDiff,
  WorkspaceSnapshot,
} from "@pi-desktop/protocol";
import { I18nProvider } from "../i18n/I18nProvider";
import { WorkspaceInspector } from "../features/workspace/WorkspaceInspector";

const {
  getWorkspaceSnapshot,
  readWorkspaceDiff,
  readWorkspaceFile,
  applyWorkspacePatch,
  searchWorkspaceFiles,
} = vi.hoisted(() => ({
  getWorkspaceSnapshot: vi.fn(),
  readWorkspaceDiff: vi.fn(),
  readWorkspaceFile: vi.fn(),
  applyWorkspacePatch: vi.fn(),
  searchWorkspaceFiles: vi.fn(),
}));

vi.mock("../platform/tauri/bridge", () => ({
  getWorkspaceSnapshot,
  readWorkspaceDiff,
  readWorkspaceFile,
  applyWorkspacePatch,
  searchWorkspaceFiles,
}));

const task: PersistedTask = {
  id: "t1",
  title: "Review",
  cwd: "/repo",
  projectRoot: "/repo",
  isolation: "worktree",
  profile: { permissionMode: "ask" },
  archived: false,
  pinned: false,
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: 0,
};

const snapshot: WorkspaceSnapshot = {
  taskId: "t1",
  root: "/repo",
  isGit: true,
  branch: "main",
  head: "abc123",
  changes: [
    { path: "src/hello.ts", status: "modified", staged: false, unstaged: true },
  ],
  files: [{ path: "src/hello.ts", size: 42 }],
  filesTruncated: false,
  generatedAt: 0,
};

const diff: WorkspaceDiff = {
  path: "src/hello.ts",
  content:
    "@@ -1,5 +1,5 @@\n const a = 1;\n-old line\n+new line\n const b = 2;\n",
  truncated: false,
  generatedAt: 0,
};

function renderInspector() {
  return render(
    <I18nProvider>
      <WorkspaceInspector
        task={task}
        runtimeStatus="idle"
        activities={[]}
        treeLoading={false}
        onRequestTree={vi.fn()}
        onError={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("WorkspaceInspector diff review", () => {
  it("renders a hunk and sends a revert to the apply bridge", async () => {
    getWorkspaceSnapshot.mockResolvedValue(snapshot);
    readWorkspaceDiff.mockResolvedValue(diff);
    readWorkspaceFile.mockResolvedValue({
      path: "src/hello.ts",
      content: "",
      language: "typescript",
      size: 0,
      binary: false,
      truncated: false,
      hash: "abc123",
    });
    applyWorkspacePatch.mockResolvedValue({
      ok: true,
      operation: "revert",
      path: "src/hello.ts",
      appliedHunks: 1,
    });

    renderInspector();

    const change = await screen.findByText("src/hello.ts");
    fireEvent.click(change);

    const revertButton = await screen.findByRole("button", { name: "Revert" });
    expect(revertButton).toBeDefined();
    expect(screen.getByText("new line")).toBeDefined();
    expect(screen.getByText("old line")).toBeDefined();

    fireEvent.click(revertButton);
    await waitFor(() =>
      expect(applyWorkspacePatch).toHaveBeenCalledWith(
        "t1",
        "src/hello.ts",
        "revert",
        expect.objectContaining({
          oldStart: 1,
          oldLines: 5,
          newStart: 1,
          newLines: 5,
          body: expect.stringContaining("@@ -1,5 +1,5 @@"),
        }),
      ),
    );
  });

  it("keeps the aggregate view read-only when no single file is selected", async () => {
    getWorkspaceSnapshot.mockResolvedValue({
      ...snapshot,
      changes: [
        { path: "src/hello.ts", status: "modified", staged: false, unstaged: true },
        { path: "README.md", status: "modified", staged: false, unstaged: true },
      ],
    });
    readWorkspaceDiff.mockResolvedValue({
      ...diff,
      path: undefined,
    });
    readWorkspaceFile.mockResolvedValue({
      path: "src/hello.ts",
      content: "",
      language: "typescript",
      size: 0,
      binary: false,
      truncated: false,
      hash: "abc123",
    });

    renderInspector();

    const allChanges = await screen.findByRole("button", {
      name: /All changes/,
    });
    fireEvent.click(allChanges);

    expect(
      await screen.findByText(
        "Select a changed file to review and revert individual hunks.",
      ),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });
});
