import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopCommand } from "@pi-desktop/protocol";
import { TaskWorkerProxy } from "../dist/runtime/task-worker-proxy.js";

test("one Pi Worker per task isolates cwd and process failure", async (context) => {
  const appDataDir = await mkdtemp(join(tmpdir(), "pi-task-workers-"));
  const cwdA = join(appDataDir, "project-a");
  const cwdB = join(appDataDir, "project-b");
  await mkdir(cwdA);
  await mkdir(cwdB);
  const eventsA = [];
  const eventsB = [];
  let exitA;
  const endpoints = [
    {
      id: "worker-test",
      name: "Worker Test",
      kind: "openai-compatible",
      baseUrl: "http://127.0.0.1:9/v1",
      models: ["test-model"],
    },
  ];

  const workerA = await TaskWorkerProxy.start({
    appDataDir,
    task: taskCreate(
      "00000000-0000-4000-8000-00000000000a",
      cwdA,
    ),
    endpoints,
    extensions: [],
    onEvent: (event) => eventsA.push(event),
    onExit: (error) => {
      exitA = error;
    },
  });
  const workerB = await TaskWorkerProxy.start({
    appDataDir,
    task: taskCreate(
      "00000000-0000-4000-8000-00000000000b",
      cwdB,
    ),
    endpoints,
    extensions: [],
    onEvent: (event) => eventsB.push(event),
    onExit: () => undefined,
  });
  context.after(() => {
    workerA.dispose();
    workerB.dispose();
  });

  assert.equal(workerA.taskState.cwd, cwdA);
  assert.equal(workerB.taskState.cwd, cwdB);
  const identityA = eventsA.find((event) => event.type === "task.status").workerId;
  const identityB = eventsB.find((event) => event.type === "task.status").workerId;
  assert.notEqual(identityA, identityB);

  workerA.child.kill("SIGKILL");
  await waitUntil(() => Boolean(exitA));
  await assert.rejects(
    workerA.request(
      createDesktopCommand({
        type: "task.abort",
        taskId: workerA.taskState.id,
      }),
    ),
    /unavailable/,
  );
  await workerB.request(
    createDesktopCommand({
      type: "task.abort",
      taskId: workerB.taskState.id,
    }),
  );
  assert.match(exitA.message, /Pi Worker exited/);
});

function taskCreate(taskId, cwd) {
  return createDesktopCommand({
    type: "task.create",
    taskId,
    cwd,
    isolation: "currentCheckout",
    profile: {
      providerId: "worker-test",
      modelId: "test-model",
      permissionMode: "ask",
    },
    resume: false,
  });
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for task Worker exit");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
