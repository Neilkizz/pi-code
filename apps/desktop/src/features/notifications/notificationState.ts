import type { DesktopTaskStatus } from "@pi-desktop/protocol";

export type TaskCompletionTransition = "completed" | "failed" | "waiting";

/** Dock badge shows the number of tasks that still need attention. */
export function computeDockBadge(statuses: DesktopTaskStatus[]): number {
  return statuses.reduce(
    (count, status) =>
      status === "waiting" || status === "failed" ? count + 1 : count,
    0,
  );
}

/**
 * A task completion transition is a live status change into one of the
 * notifiable terminal/pending states. The first observed status for a task is
 * not a transition (avoid notifying on reconnect).
 */
export function detectStatusTransition(
  previous: DesktopTaskStatus | undefined,
  next: DesktopTaskStatus,
): TaskCompletionTransition | null {
  if (previous === undefined || previous === next) return null;
  if (next === "completed" || next === "failed" || next === "waiting") {
    return next;
  }
  return null;
}
