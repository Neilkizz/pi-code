import type { PersistedTask, TaskPermissionMode } from "@pi-desktop/protocol";

export function compactJson(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const encoded = JSON.stringify(value);
  return encoded.length > 240 ? `${encoded.slice(0, 237)}…` : encoded;
}

export function compactPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return value;
  }
  return `…/${parts.slice(-2).join("/")}`;
}

export function filterTasks(tasks: PersistedTask[], query: string): PersistedTask[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return tasks;
  return tasks.filter((task) =>
    [task.title, task.projectRoot, task.cwd, task.worktree?.branch]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function permissionModeLabel(mode: TaskPermissionMode): string {
  switch (mode) {
    case "ask":
      return "Ask permissions";
    case "acceptEdits":
      return "Accept edits";
    case "plan":
      return "Plan mode";
    case "auto":
      return "Auto · unavailable";
  }
}
