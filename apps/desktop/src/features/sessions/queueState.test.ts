import { describe, expect, it } from "vitest";
import type { QueuedPrompt } from "./types";
import { reconcileQueuedPrompts, userTextMatches } from "./queueState";

const pending: QueuedPrompt = {
  id: "q-1",
  text: "continue please",
  mode: "followUp",
  createdAt: 1,
};
const pending2: QueuedPrompt = {
  id: "q-2",
  text: "now steer",
  mode: "steer",
  createdAt: 2,
};
const delivered: QueuedPrompt = {
  id: "q-3",
  text: "already processed",
  mode: "followUp",
  createdAt: 3,
};

describe("reconcileQueuedPrompts", () => {
  it("keeps items still present in the host queue", () => {
    const result = reconcileQueuedPrompts(
      [pending, pending2],
      ["now steer"],
      ["continue please"],
    );
    expect(result.map((item) => item.id).sort()).toEqual(["q-1", "q-2"]);
  });

  it("drops delivered and cleared items", () => {
    const result = reconcileQueuedPrompts(
      [pending, delivered],
      [],
      ["continue please"],
    );
    expect(result.map((item) => item.id)).toEqual(["q-1"]);
  });

  it("empties the list when the queue is cleared", () => {
    const result = reconcileQueuedPrompts([pending, pending2], [], []);
    expect(result).toEqual([]);
  });
});

describe("userTextMatches", () => {
  it("matches plain texts", () => {
    expect(userTextMatches("hello", "hello")).toBe(true);
    expect(userTextMatches("hello", "world")).toBe(false);
  });

  it("ignores the optimistic attachments suffix", () => {
    expect(
      userTextMatches(
        "analyze\n\nAttachments: file.png",
        "analyze",
      ),
    ).toBe(true);
  });
});
