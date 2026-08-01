import type {
  RepositoryInfo,
  TaskAttachment,
  TaskIsolation,
} from "@pi-desktop/protocol";

export type ComposerBlockReason =
  | "runtime-starting"
  | "project-required"
  | "repository-checking"
  | "git-required"
  | "content-required"
  | "task-restoring"
  | "submitting";

export interface ComposerStateInput {
  hasTask: boolean;
  cwd: string;
  prompt: string;
  attachments: TaskAttachment[];
  isolation: TaskIsolation;
  repositoryInfo: RepositoryInfo | null;
  projectCheck: "idle" | "checking" | "git" | "notGit";
  hostReady: boolean;
  taskConnected: boolean;
  taskRunning: boolean;
  isSubmitting: boolean;
}

export interface ComposerState {
  hasContent: boolean;
  canCreateTask: boolean;
  canSubmit: boolean;
  blockReason?: ComposerBlockReason;
}

/** Keeps send eligibility deterministic and independently testable. */
export function deriveComposerState(input: ComposerStateInput): ComposerState {
  const hasContent = Boolean(input.prompt.trim() || input.attachments.length > 0);
  const canCreateTask =
    input.hostReady &&
    Boolean(input.cwd.trim()) &&
    input.projectCheck !== "checking" &&
    (input.isolation !== "worktree" || Boolean(input.repositoryInfo));

  if (input.isSubmitting) {
    return { hasContent, canCreateTask, canSubmit: false, blockReason: "submitting" };
  }
  if (!input.hostReady) {
    return { hasContent, canCreateTask, canSubmit: false, blockReason: "runtime-starting" };
  }
  if (!hasContent) {
    return { hasContent, canCreateTask, canSubmit: false, blockReason: "content-required" };
  }
  if (input.hasTask) {
    if (!input.taskConnected) {
      return {
        hasContent,
        canCreateTask,
        canSubmit: false,
        blockReason: "task-restoring",
      };
    }
    if (input.taskRunning) {
      // Follow-up mode: the send button queues a follow-up while the agent works.
      return { hasContent, canCreateTask, canSubmit: true };
    }
    return { hasContent, canCreateTask, canSubmit: true };
  }
  if (!input.cwd.trim()) {
    return { hasContent, canCreateTask, canSubmit: false, blockReason: "project-required" };
  }
  if (input.projectCheck === "checking") {
    return { hasContent, canCreateTask, canSubmit: false, blockReason: "repository-checking" };
  }
  if (input.isolation === "worktree" && !input.repositoryInfo) {
    return { hasContent, canCreateTask, canSubmit: false, blockReason: "git-required" };
  }
  return { hasContent, canCreateTask, canSubmit: canCreateTask };
}
