import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  hashFullSnapshot,
  hashScannableSnapshot,
} from "../dist/runtime/snapshot-integrity.js";

test("snapshot hashing matches Rust component-wise PathBuf ordering", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-snapshot-order-"));
  await mkdir(join(root, "a"));
  await writeFile(join(root, "a", "nested.json"), "nested");
  await writeFile(join(root, "a-file.json"), "sibling");
  await writeFile(join(root, "z.json"), "last");

  const digest = createHash("sha256");
  for (const [path, content] of [
    ["a/nested.json", "nested"],
    ["a-file.json", "sibling"],
    ["z.json", "last"],
  ]) {
    digest.update(path);
    digest.update(Buffer.from([0]));
    digest.update(content);
  }
  const expected = digest.digest("hex");

  assert.equal(await hashFullSnapshot(root), expected);
  assert.equal(await hashScannableSnapshot(root), expected);
});
