import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ManagedExtensionWorker,
  startManagedExtensionWorkers,
} from "../dist/runtime/managed-extension-worker.js";

const fixtureDirectory = dirname(
  fileURLToPath(new URL("./fixtures/safe-tool-extension.ts", import.meta.url)),
);

test("managed Extension tools execute through an isolated worker", async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-managed-extension-project-"));
  const worker = await ManagedExtensionWorker.start(
    await config("safe", "safe-tool-extension.ts"),
    cwd,
  );
  context.after(() => worker.dispose());

  assert.deepEqual(worker.tools.map((tool) => tool.name), ["managed_echo"]);
  const updates = [];
  const result = await worker.invoke(
    "managed_echo",
    "tool-call-1",
    { value: "hello" },
    undefined,
    (update) => updates.push(update),
  );

  assert.equal(result.content[0].text, "hello:rpc:false");
  assert.equal(result.details.isolated, true);
  assert.equal(updates[0].details.phase, "echo");
});

test("managed Extension worker denies filesystem, process, and network escape", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pi-managed-extension-security-"));
  const project = join(root, "project");
  const outside = join(root, "outside-secret.txt");
  const projectTarget = join(project, "escape.txt");
  await writeFile(outside, "secret");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));

  const worker = await ManagedExtensionWorker.start(
    await config("probe", "permission-probe-extension.ts"),
    project,
  );
  context.after(() => worker.dispose());
  const result = await worker.invoke("permission_probe", "tool-call-2", {
    outsidePath: outside,
    projectPath: projectTarget,
  });
  const denied = JSON.parse(result.content[0].text);

  assert.deepEqual(denied, {
    fileRead: "ERR_ACCESS_DENIED",
    fileWrite: "ERR_ACCESS_DENIED",
    childProcess: "ERR_ACCESS_DENIED",
    network: "ERR_ACCESS_DENIED",
  });
  await assert.rejects(readFile(projectTarget));
});

test("managed Extension worker refuses a snapshot whose hash changed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-managed-extension-hash-"));
  const stale = await config("stale", "safe-tool-extension.ts");
  stale.contentHash = "0".repeat(64);
  await assert.rejects(
    ManagedExtensionWorker.start(stale, cwd),
    /snapshot hash mismatch/,
  );
});

test("a broken managed Extension is isolated from working Extensions", async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-managed-extension-isolation-"));
  const stale = await config("stale", "safe-tool-extension.ts");
  stale.contentHash = "0".repeat(64);
  const failures = [];
  const workers = await startManagedExtensionWorkers(
    [stale, await config("safe", "safe-tool-extension.ts")],
    cwd,
    (failure) => failures.push(failure),
  );
  context.after(() => workers.forEach((worker) => worker.dispose()));

  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].tools.map((tool) => tool.name), ["managed_echo"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].extensionId, "stale");
  assert.match(failures[0].message, /snapshot hash mismatch/);
});

async function config(id, filename) {
  const installPath = join(fixtureDirectory, filename);
  const content = await readFile(installPath);
  const contentHash = createHash("sha256")
    .update(filename)
    .update(Buffer.from([0]))
    .update(content)
    .digest("hex");
  return {
    id,
    name: id,
    installPath,
    contentHash,
  };
}
