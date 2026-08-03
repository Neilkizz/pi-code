import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_PROTOCOL_VERSION,
  createDesktopCommand,
  createHostMessage,
  decodeDesktopToHostMessage,
} from "../dist/index.js";

test("creates and validates a versioned desktop command", () => {
  const command = createDesktopCommand(
    {
      type: "task.prompt",
      taskId: "00000000-0000-4000-8000-000000000001",
      prompt: "Review this project",
      attachments: [],
    },
    { messageId: "command-test", timestamp: 1 },
  );

  assert.equal(command.protocolVersion, DESKTOP_PROTOCOL_VERSION);
  assert.equal(command.messageId, "command-test");
  assert.equal(command.idempotencyKey, "command-test");
  assert.deepEqual(decodeDesktopToHostMessage(command), {
    ok: true,
    message: command,
  });
});

test("rejects unknown versions and malformed payloads", () => {
  const unsupported = decodeDesktopToHostMessage({
    protocolVersion: 99,
    messageId: "unsupported",
    idempotencyKey: "unsupported",
    timestamp: 1,
    type: "task.abort",
    taskId: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "PROTOCOL_VERSION_UNSUPPORTED");
  assert.equal(unsupported.error.correlationId, "unsupported");

  const malformed = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.prompt",
      taskId: "not-a-uuid",
      prompt: "",
      attachments: [],
    }),
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "INVALID_MESSAGE");
});

test("validates task.getTree and rejects malformed task ids", () => {
  const valid = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.getTree",
      taskId: "00000000-0000-4000-8000-000000000001",
    }),
  );
  assert.equal(valid.ok, true);

  const bad = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.getTree",
      taskId: "not-a-uuid",
    }),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "INVALID_MESSAGE");
});

test("validates task.prompt streamingBehavior and promptQueueClear", () => {
  const followUp = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.prompt",
      taskId: "00000000-0000-4000-8000-000000000001",
      prompt: "go on",
      attachments: [],
      streamingBehavior: "followUp",
    }),
  );
  assert.equal(followUp.ok, true);

  const badBehavior = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.prompt",
      taskId: "00000000-0000-4000-8000-000000000001",
      prompt: "go on",
      attachments: [],
      streamingBehavior: "sideways",
    }),
  );
  assert.equal(badBehavior.ok, false);
  assert.equal(badBehavior.error.code, "INVALID_MESSAGE");

  const clear = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.promptQueueClear",
      taskId: "00000000-0000-4000-8000-000000000001",
    }),
  );
  assert.equal(clear.ok, true);

  const clearBad = decodeDesktopToHostMessage(
    createDesktopCommand({
      type: "task.promptQueueClear",
      taskId: "not-a-uuid",
    }),
  );
  assert.equal(clearBad.ok, false);
});

test("host messages carry worker and sequence metadata", () => {
  const event = createHostMessage(
    {
      type: "task.event",
      taskId: "00000000-0000-4000-8000-000000000001",
      event: { type: "agent_start" },
    },
    {
      workerId: "worker-1",
      taskId: "00000000-0000-4000-8000-000000000001",
      seq: 7,
      timestamp: 1,
    },
  );

  assert.equal(event.protocolVersion, DESKTOP_PROTOCOL_VERSION);
  assert.equal(event.workerId, "worker-1");
  assert.equal(event.seq, 7);
});

test("managed Extension configuration requires immutable snapshot identity", () => {
  const command = createDesktopCommand({
    type: "host.configureExtensions",
    extensions: [
      {
        id: "extension-1",
        name: "Review helper",
        installPath: "/private/app-data/extensions/review/source",
        contentHash: "a".repeat(64),
      },
    ],
  });
  assert.equal(decodeDesktopToHostMessage(command).ok, true);

  const legacy = createDesktopCommand({
    type: "host.configureExtensions",
    paths: ["/tmp/untrusted-extension.ts"],
  });
  assert.equal(decodeDesktopToHostMessage(legacy).ok, false);
});
