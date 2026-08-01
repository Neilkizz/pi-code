import type { SessionTree, TaskTranscriptMessage } from "@pi-desktop/protocol";

export interface ActivityItem {
  id: string;
  kind: "system" | "tool" | "error";
  title: string;
  detail?: string;
  input?: string;
  output?: string;
  toolCallId?: string;
  status?: "running" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
}

export interface QueuedPrompt {
  id: string;
  text: string;
  mode: "followUp" | "steer";
  createdAt: number;
}

export interface TaskViewState {
  messages: TaskTranscriptMessage[];
  streamingAssistantId?: string;
  activities: ActivityItem[];
  restored: boolean;
  /** Read-only session tree (from task.getTree). Null = not loaded. */
  tree?: SessionTree | null;
  treeLoading: boolean;
  /** Follow-ups/steers submitted while the agent was running and not yet delivered. */
  queuedPrompts: QueuedPrompt[];
}

export const EMPTY_TASK_VIEW: TaskViewState = {
  messages: [],
  activities: [],
  restored: false,
  tree: null,
  treeLoading: false,
  queuedPrompts: [],
};
