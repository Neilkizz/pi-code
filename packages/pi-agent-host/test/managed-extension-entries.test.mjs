import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveManagedExtensionEntries } from "../dist/runtime/managed-extension-entries.js";

test("managed npm wrappers resolve only declared Pi extension entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-managed-wrapper-"));
  const extension = join(root, "node_modules", "example", "index.ts");
  await mkdir(join(root, "node_modules", "example"), { recursive: true });
  await writeFile(extension, "export default function extension() {}");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "pi-desktop-managed-package",
      pi: { extensions: ["node_modules/example/index.ts"] },
    }),
  );

  assert.deepEqual(await resolveManagedExtensionEntries(root), [
    await realpath(extension),
  ]);
});

test("managed npm wrappers reject entries outside the quarantine root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pi-managed-wrapper-escape-"));
  const root = join(parent, "source");
  await mkdir(root);
  await writeFile(join(parent, "outside.ts"), "export default () => {}");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ pi: { extensions: ["../outside.ts"] } }),
  );

  await assert.rejects(
    resolveManagedExtensionEntries(root),
    /escapes its quarantine snapshot/,
  );
});
