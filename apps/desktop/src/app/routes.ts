/**
 * Product-level workspace routes. Keeping this separate from the shell makes
 * future Ask/Work/Build routes additive instead of turning App.tsx into a
 * second router.
 */
export const workspaceViews = ["tasks", "projects", "settings"] as const;

export type WorkspaceView = (typeof workspaceViews)[number];

export function isWorkspaceView(value: string): value is WorkspaceView {
  return (workspaceViews as readonly string[]).includes(value);
}
