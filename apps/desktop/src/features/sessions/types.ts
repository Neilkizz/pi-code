import type { TaskTranscriptMessage } from "@pi-desktop/protocol";

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

export interface TaskViewState {
  messages: TaskTranscriptMessage[];
  streamingAssistantId?: string;
  activities: ActivityItem[];
  restored: boolean;
}

export const EMPTY_TASK_VIEW: TaskViewState = {
  messages: [],
  activities: [],
  restored: false,
};
