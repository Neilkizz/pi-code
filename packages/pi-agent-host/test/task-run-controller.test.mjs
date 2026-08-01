import assert from "node:assert/strict";
import test from "node:test";
import { TaskRunController } from "../dist/runtime/task-run-controller.js";

test("prompt start is non-blocking and abort suppresses stale failure state", async () => {
  const prompt = deferred();
  const statuses = [];
  let abortCalls = 0;
  let cancelCalls = 0;
  const controller = new TaskRunController(
    {
      prompt: () => prompt.promise,
      abort: async () => {
        abortCalls += 1;
      },
    },
    (status, error) => statuses.push({ status, error }),
    () => {
      cancelCalls += 1;
    },
  );

  assert.deepEqual(controller.start("work"), { accepted: true });
  assert.equal(controller.isActive, true);
  assert.deepEqual(statuses, [{ status: "running", error: undefined }]);

  await controller.abort();
  assert.equal(abortCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.equal(controller.isActive, false);
  assert.deepEqual(statuses, [
    { status: "running", error: undefined },
    { status: "idle", error: undefined },
  ]);

  prompt.reject(new Error("aborted"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    statuses.some((entry) => entry.status === "failed"),
    false,
  );
});

test("prompt completion and failure emit terminal states", async () => {
  const statuses = [];
  const session = {
    prompt: async (prompt) => {
      if (prompt === "fail") {
        throw new Error("model unavailable");
      }
    },
    abort: async () => undefined,
  };
  const controller = new TaskRunController(
    session,
    (status, error) => statuses.push({ status, error }),
    () => undefined,
  );

  controller.start("complete");
  await new Promise((resolve) => setImmediate(resolve));
  controller.start("fail");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(statuses, [
    { status: "running", error: undefined },
    { status: "completed", error: undefined },
    { status: "running", error: undefined },
    { status: "failed", error: "model unavailable" },
  ]);
});

test("forwards verified image payloads through prompt options", async () => {
  const calls = [];
  const controller = new TaskRunController(
    {
      prompt: async (prompt, options) => calls.push({ prompt, options }),
      abort: async () => undefined,
    },
    () => undefined,
    () => undefined,
  );
  const image = {
    type: "image",
    data: "aGVsbG8=",
    mimeType: "image/png",
  };
  controller.start("inspect", [image]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    { prompt: "inspect", options: { images: [image] } },
  ]);
});

test("queues a follow-up while active and rejects a plain duplicate", async () => {
  const prompt = deferred();
  const calls = [];
  const statuses = [];
  const controller = new TaskRunController(
    {
      prompt: async (text, options) => {
        calls.push({ text, options });
        return prompt.promise;
      },
      abort: async () => undefined,
      clearQueue: () => ({ steering: [], followUp: [] }),
    },
    (status) => statuses.push(status),
    () => undefined,
  );

  assert.deepEqual(controller.start("first"), { accepted: true });
  assert.throws(() => controller.start("second"), /already running/);
  assert.deepEqual(controller.start("follow", [], "followUp"), {
    accepted: true,
    queued: true,
  });
  assert.equal(controller.isActive, true);
  assert.deepEqual(calls.map((entry) => entry.text), ["first", "follow"]);
  assert.equal(calls[1].options.streamingBehavior, "followUp");
  assert.deepEqual(statuses, ["running"]);

  prompt.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.isActive, false);
});

test("clearQueue and abort both drop pending prompts", async () => {
  let clearCalls = 0;
  const controller = new TaskRunController(
    {
      prompt: async () => undefined,
      abort: async () => undefined,
      clearQueue: () => {
        clearCalls += 1;
        return { steering: [], followUp: [] };
      },
    },
    () => undefined,
    () => undefined,
  );

  controller.start("work");
  await controller.clearQueue();
  assert.equal(clearCalls, 1);
  await controller.abort();
  assert.equal(clearCalls, 2);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
