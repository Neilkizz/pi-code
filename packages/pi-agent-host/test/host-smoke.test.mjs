import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

test("compiled Pi Host completes the JSONL bootstrap handshake", async (context) => {
  const appDataDir = await mkdtemp(join(tmpdir(), "pi-desktop-host-"));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../dist/main.js", import.meta.url))],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  context.after(() => {
    child.kill("SIGTERM");
  });

  const messages = [];
  const errors = [];
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    messages.push(JSON.parse(line));
  });
  const errorLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
  errorLines.on("line", (line) => {
    errors.push(line);
  });

  child.stdin.write(
    `${JSON.stringify(
      command(
        {
          type: "host.bootstrap",
          appDataDir,
        },
        "smoke-bootstrap",
      ),
    )}\n`,
  );

  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "smoke-bootstrap" &&
          message.ok === true,
      ),
    () => errors.join("\n"),
  );

  assert.ok(
    messages.some(
      (message) =>
        message.type === "host.status" && message.state?.status === "ready",
    ),
  );
  assert.ok(
    messages.some(
      (message) =>
        message.type === "host.hello" &&
        message.hello?.selectedVersion === 2 &&
        message.protocolVersion === 2,
    ),
  );
  assert.match(
    messages.find(
      (message) => message.correlationId === "smoke-bootstrap",
    ).result.version,
    /^\d+\.\d+\.\d+$/,
  );

  child.stdin.write(
    `${JSON.stringify(
      command(
        {
          type: "host.configureEndpoints",
          endpoints: [
            {
              id: "desktop-smoke",
              name: "Smoke Endpoint",
              kind: "openai-compatible",
              baseUrl: "http://localhost:9999/v1",
              models: ["smoke-model"],
            },
          ],
        },
        "smoke-endpoints",
      ),
    )}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "smoke-endpoints" &&
          message.ok === true,
      ),
    () => errors.join("\n"),
  );
  assert.equal(
    messages.find(
      (message) => message.correlationId === "smoke-endpoints",
    ).result.configured,
    1,
  );

  child.stdin.write(
    `${JSON.stringify(
      command(
        {
          type: "host.configureExtensions",
          extensions: [],
        },
        "smoke-extensions",
      ),
    )}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "smoke-extensions" &&
          message.ok === true,
      ),
    () => errors.join("\n"),
  );
  assert.equal(
    messages.find(
      (message) => message.correlationId === "smoke-extensions",
    ).result.configured,
    0,
  );

  const projectDir = join(appDataDir, "project");
  await mkdir(projectDir);
  const createTask = {
    type: "task.create",
    taskId: "00000000-0000-4000-8000-000000000001",
    cwd: projectDir,
    isolation: "currentCheckout",
    profile: {
      providerId: "desktop-smoke",
      modelId: "smoke-model",
      permissionMode: "ask",
    },
  };
  child.stdin.write(
    `${JSON.stringify(
      command(
        {
          ...createTask,
          resume: false,
        },
        "smoke-task-create",
      ),
    )}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "smoke-task-create" &&
          message.ok === true,
      ),
    () =>
      [
        ...errors,
        ...messages
          .filter((message) => message.correlationId === "smoke-task-create")
          .map((message) => JSON.stringify(message)),
      ].join("\n"),
  );
  assert.equal(
    messages.find(
      (message) => message.correlationId === "smoke-task-create",
    ).result.status,
    "idle",
  );
  child.stdin.write(
    `${JSON.stringify(
      command(
        {
          type: "task.close",
          taskId: createTask.taskId,
        },
        "smoke-task-close",
      ),
    )}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "smoke-task-close" &&
          message.ok === true,
      ),
    () => errors.join("\n"),
  );

  const sessionDir = join(appDataDir, "sessions", createTask.taskId);
  const persisted = SessionManager.create(projectDir, sessionDir);
  persisted.appendMessage({
    role: "user",
    content: [{ type: "text", text: "persisted prompt" }],
  });
  persisted.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "persisted response" }],
  });
  assert.equal(
    (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).length,
    1,
  );

  child.stdin.write(
    `${JSON.stringify(
      command(
        {
          ...createTask,
          resume: true,
        },
        "smoke-task-resume",
      ),
    )}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "smoke-task-resume" &&
          message.ok === true,
      ),
    () => errors.join("\n"),
  );
  assert.equal(
    (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).length,
    1,
  );
  assert.deepEqual(
    messages.find(
      (message) =>
        message.type === "task.history" &&
        message.taskId === createTask.taskId,
    ).messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "persisted prompt" },
      { role: "assistant", text: "persisted response" },
    ],
  );

  const taskMessages = messages.filter(
    (message) => message.taskId === createTask.taskId,
  );
  assert.ok(taskMessages.length > 0);
  assert.ok(taskMessages.every((message) => message.workerId));
  const sequencesByWorker = Map.groupBy(
    taskMessages,
    (message) => message.workerId,
  );
  assert.ok(
    sequencesByWorker.size >= 2,
    "coordinator and per-task Worker must use distinct identities",
  );
  for (const workerMessages of sequencesByWorker.values()) {
    const sequences = workerMessages.map((message) => message.seq);
    assert.deepEqual(
      sequences,
      [...sequences].sort((left, right) => left - right),
      "each Worker sequence must be monotonic",
    );
    assert.equal(new Set(sequences).size, sequences.length);
  }

  child.stdin.write(
    `${JSON.stringify({
      ...command({ type: "task.abort", taskId: createTask.taskId }, "bad-version"),
      protocolVersion: 999,
    })}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "bad-version" &&
          message.ok === false,
      ),
    () => errors.join("\n"),
  );
  assert.equal(
    messages.find((message) => message.correlationId === "bad-version").error
      .code,
    "PROTOCOL_VERSION_UNSUPPORTED",
  );
});

function command(payload, messageId) {
  return {
    protocolVersion: 2,
    messageId,
    idempotencyKey: messageId,
    timestamp: Date.now(),
    ...payload,
  };
}

async function waitUntil(predicate, describeError, timeoutMs = 8_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for Pi Host response${describeError() ? `:\n${describeError()}` : ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
