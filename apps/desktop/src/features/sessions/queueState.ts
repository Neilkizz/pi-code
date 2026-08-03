import type { QueuedPrompt } from "./types";

/**
 * Keep only queued prompts whose text is still present in the host's pending
 * queue (from the SDK `queue_update` event). Items that were delivered or
 * cleared are dropped.
 */
export function reconcileQueuedPrompts(
  queued: QueuedPrompt[],
  steering: string[],
  followUp: string[],
): QueuedPrompt[] {
  const pending = new Set([...steering, ...followUp]);
  return queued.filter((item) => pending.has(item.text));
}

/**
 * Whether two user-message texts refer to the same message, ignoring the
 * optimistic "Attachments: …" suffix the composer appends locally.
 */
export function userTextMatches(a: string, b: string): boolean {
  const stripAttachments = (value: string) =>
    value.replace(/\n\nAttachments:[\s\S]*$/, "").trim();
  return stripAttachments(a) === stripAttachments(b);
}
