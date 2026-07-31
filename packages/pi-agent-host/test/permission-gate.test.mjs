import assert from "node:assert/strict";
import test from "node:test";
import { PermissionGate } from "../dist/runtime/permission-gate.js";

test("ask permission mode allows reads and asks before changes", async () => {
  const requests = [];
  const waiting = [];
  const gate = new PermissionGate(
    "task-test",
    "ask",
    "currentCheckout",
    (request) => requests.push(request),
    (value) => waiting.push(value),
  );

  assert.equal(
    await gate.authorize("read", { path: "README.md" }),
    undefined,
  );
  assert.equal(requests.length, 0);

  const decision = gate.authorize("edit", {
    path: "README.md",
    oldText: "a",
    newText: "b",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].taskId, "task-test");
  assert.equal(requests[0].toolName, "edit");
  assert.deepEqual(waiting, [true]);

  gate.respond(requests[0].id, true);
  assert.equal(await decision, requests[0].id);
  assert.deepEqual(waiting, [true, false]);
});

test("ask permission mode blocks denied and cancelled tool calls", async () => {
  const requests = [];
  const gate = new PermissionGate(
    "task-test",
    "ask",
    "currentCheckout",
    (request) => requests.push(request),
    () => undefined,
  );

  const denied = gate.authorize("bash", { command: "pwd" });
  gate.respond(requests[0].id, false);
  await assert.rejects(denied, /denied by user/i);

  const cancelled = gate.authorize("write", { path: "x" });
  gate.cancelAll("Task stopped by user");
  await assert.rejects(cancelled, /stopped by user/i);
  assert.equal(gate.pendingCount, 0);
});

test("accept edits mode allows file edits but still asks before shell", async () => {
  const requests = [];
  const gate = new PermissionGate(
    "task-test",
    "acceptEdits",
    "worktree",
    (request) => requests.push(request),
    () => undefined,
  );
  assert.equal(
    await gate.authorize("write", { path: "x" }),
    undefined,
  );
  assert.equal(requests.length, 0);

  const shell = gate.authorize("bash", { command: "pwd" });
  assert.equal(requests.length, 1);
  gate.respond(requests[0].id, true);
  assert.equal(await shell, requests[0].id);
});

test("plan and auto modes fail closed for mutating tools", async () => {
  for (const mode of ["plan", "auto"]) {
    const gate = new PermissionGate(
      "task-test",
      mode,
      "worktree",
      () => assert.fail("blocked modes must not open an approval"),
      () => undefined,
    );
    await assert.rejects(
      gate.authorize("bash", { command: "pwd" }),
      /mode|isolation/i,
    );
  }
});

test("an already-aborted tool call fails closed without opening a request", async () => {
  const requests = [];
  const gate = new PermissionGate(
    "task-test",
    "ask",
    "currentCheckout",
    (request) => requests.push(request),
    () => undefined,
  );
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    gate.authorize("write", { path: "x" }, controller.signal),
    /cancelled/i,
  );
  assert.equal(requests.length, 0);
});

test("unmanaged Extension tools are blocked before execution", async () => {
  const gate = new PermissionGate(
    "task-test",
    "ask",
    "currentCheckout",
    () => assert.fail("unmanaged tools must not open an approval"),
    () => undefined,
  );
  const handler = bindToolCallHandler(gate);
  const result = await handler(
    { toolName: "third_party_tool", toolCallId: "extension-1", input: {} },
    {},
  );
  assert.equal(result.block, true);
  assert.match(result.reason, /not managed|disabled/i);
});

function bindToolCallHandler(gate) {
  let handler;
  gate.extension.factory({
    on(event, callback) {
      if (event === "tool_call") {
        handler = callback;
      }
    },
  });
  assert.equal(typeof handler, "function");
  return handler;
}
