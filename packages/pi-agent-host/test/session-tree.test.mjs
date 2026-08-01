import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapSessionTree,
  toTranscriptMessages,
} from "../dist/runtime/desktop-host.js";

test("toTranscriptMessages includes compaction and branch summaries", () => {
  const messages = [
    { role: "user", content: "Hello", timestamp: 1000 },
    { role: "assistant", content: "Hi there", timestamp: 2000 },
    {
      role: "compactionSummary",
      summary: "Earlier messages summarized.",
      timestamp: 3000,
    },
    {
      role: "branchSummary",
      summary: "Branched to fix a bug.",
      fromId: "entry-2",
      timestamp: 4000,
      label: "fix",
    },
  ];
  const transcript = toTranscriptMessages(messages);
  assert.equal(transcript.length, 4);
  assert.deepEqual(
    transcript.map((message) => message.role),
    ["user", "assistant", "compactionSummary", "branchSummary"],
  );
  assert.equal(transcript[2].text, "Earlier messages summarized.");
  assert.equal(transcript[3].text, "Branched to fix a bug.");
  assert.equal(transcript[3].label, "fix");
});

test("toTranscriptMessages strips attachment context and drops empty text", () => {
  const messages = [
    { role: "user", content: "Hello\n\n<pi-desktop-attachments>secret", timestamp: 1 },
    { role: "assistant", content: "", timestamp: 2 },
    { role: "branchSummary", summary: "", fromId: "x", timestamp: 3 },
  ];
  const transcript = toTranscriptMessages(messages);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].role, "user");
  assert.ok(!transcript[0].text.includes("pi-desktop-attachments"));
});

test("mapSessionTree flattens the tree and marks the current leaf path", () => {
  const fakeManager = {
    getLeafId: () => "e3",
    getTree: () => [
      {
        entry: { type: "session", id: "e0", parentId: null, timestamp: "t0" },
        children: [
          {
            entry: {
              type: "message",
              id: "e1",
              parentId: "e0",
              timestamp: "t1",
              message: { role: "user", content: "first" },
            },
            children: [],
          },
          {
            entry: {
              type: "compaction",
              id: "e2",
              parentId: "e0",
              timestamp: "t2",
              summary: "Summarized earlier.",
            },
            children: [
              {
                entry: {
                  type: "message",
                  id: "e3",
                  parentId: "e2",
                  timestamp: "t3",
                  message: { role: "assistant", content: "after compact" },
                },
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
  const tree = mapSessionTree(fakeManager, "task-9");
  assert.equal(tree.taskId, "task-9");
  assert.equal(tree.leafId, "e3");
  assert.equal(tree.entries.length, 4);

  const current = tree.entries
    .filter((entry) => entry.current)
    .map((entry) => entry.entryId)
    .sort();
  assert.deepEqual(current, ["e0", "e2", "e3"]);

  const compaction = tree.entries.find((entry) => entry.entryId === "e2");
  assert.equal(compaction.type, "compaction");
  assert.equal(compaction.text, "Summarized earlier.");
  assert.equal(compaction.parentEntryId, "e0");

  const message = tree.entries.find((entry) => entry.entryId === "e1");
  assert.equal(message.current, false);
  assert.equal(message.text, "first");
});
