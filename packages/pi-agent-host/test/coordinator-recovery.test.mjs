import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopCommand } from "@pi-desktop/protocol";
import { DesktopHost } from "../dist/runtime/desktop-host.js";

test("coordinator rehydrates a crashed task without replaying its prompt", async (context) => {
  const appDataDir = await mkdtemp(join(tmpdir(), "pi-worker-recovery-"));
  const cwd = join(appDataDir, "project");
  await mkdir(cwd);
  const messages = [];
  const host = new DesktopHost((message) => messages.push(message));
  context.after(() => host.dispose());

  await host.handle(
    createDesktopCommand({
      type: "host.bootstrap",
      appDataDir,
    }),
  );
  await host.handle(
    createDesktopCommand({
      type: "host.configureEndpoints",
      endpoints: [
        {
          id: "recovery-test",
          name: "Recovery Test",
          kind: "openai-compatible",
          baseUrl: "http://127.0.0.1:9/v1",
          models: ["test-model"],
        },
      ],
    }),
  );
  await host.handle(
    createDesktopCommand({
      type: "host.configureExtensions",
      extensions: [],
    }),
  );
  const taskId = "00000000-0000-4000-8000-00000000000c";
  await host.handle(taskCreate(taskId, cwd));
  const originalWorker = host.taskWorkers.get(taskId);
  const originalIdentity = messages
    .find(
      (message) =>
        message.type === "task.status" &&
        message.task.id === taskId &&
        message.task.status === "idle",
    )
    .workerId;

  originalWorker.child.kill("SIGKILL");
  await waitUntil(() =>
    messages.some(
      (message) =>
        message.type === "task.status" &&
        message.task.id === taskId &&
        message.task.status === "failed",
    ),
  );
  await waitUntil(() => {
    const current = host.taskWorkers.get(taskId);
    return current && current !== originalWorker;
  });
  const recoveredIdentity = [...messages]
    .reverse()
    .find(
      (message) =>
        message.type === "task.status" &&
        message.task.id === taskId &&
        message.task.status === "idle",
    ).workerId;

  assert.notEqual(recoveredIdentity, originalIdentity);
  assert.equal(
    messages.some(
      (message) =>
        message.type === "task.event" &&
        message.event.type === "agent_start",
    ),
    false,
    "recovery must not replay the previous prompt",
  );

  const abort = createDesktopCommand({
    type: "task.abort",
    taskId,
  });
  await host.handle(abort);
  assert.equal(
    messages.find(
      (message) =>
        message.type === "response" &&
        message.correlationId === abort.messageId,
    ).ok,
    true,
  );
});

function taskCreate(taskId, cwd) {
  return createDesktopCommand({
    type: "task.create",
    taskId,
    cwd,
    isolation: "currentCheckout",
    profile: {
      providerId: "recovery-test",
      modelId: "test-model",
      permissionMode: "ask",
    },
    resume: false,
  });
}

async function waitUntil(predicate, timeoutMs = 8_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for task Worker recovery");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
