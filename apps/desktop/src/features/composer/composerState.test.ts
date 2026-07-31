import { describe, expect, it } from "vitest";
import { deriveComposerState, type ComposerStateInput } from "./composerState";

const base: ComposerStateInput = {
  hasTask: true,
  cwd: "/tmp/project",
  prompt: "Implement the test",
  attachments: [],
  isolation: "worktree",
  repositoryInfo: null,
  projectCheck: "git",
  hostReady: true,
  taskConnected: true,
  taskRunning: false,
  isSubmitting: false,
};

describe("deriveComposerState", () => {
  it("accepts an attachment-only prompt after a task is connected", () => {
    const state = deriveComposerState({ ...base, prompt: "", attachments: [{} as never] });
    expect(state.canSubmit).toBe(true);
  });

  it("blocks a duplicate send until the host acknowledges it", () => {
    const state = deriveComposerState({ ...base, isSubmitting: true });
    expect(state.canSubmit).toBe(false);
    expect(state.blockReason).toBe("submitting");
  });

  it("requires a git project for a new isolated task", () => {
    const state = deriveComposerState({ ...base, hasTask: false, repositoryInfo: null });
    expect(state.canSubmit).toBe(false);
    expect(state.blockReason).toBe("git-required");
  });

  it("allows a new task in the current checkout without git metadata", () => {
    const state = deriveComposerState({
      ...base,
      hasTask: false,
      isolation: "currentCheckout",
      repositoryInfo: null,
    });
    expect(state.canSubmit).toBe(true);
  });
});
