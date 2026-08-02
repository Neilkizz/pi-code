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

  const result = await resolveManagedExtensionEntries(root);
  assert.deepEqual(result.paths, [await realpath(extension)]);
  assert.deepEqual(result.surface, {
    tools: [],
    commands: [],
    hooks: [],
    renderers: [],
    flags: [],
    shortcuts: [],
  });
});

test("structured pi.extensions entries declare tools, commands, hooks, renderers", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-managed-surface-"));
  const entry = join(root, "src", "index.ts");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(entry, "export default function extension() {}");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "pi-desktop-managed-surface",
      pi: {
        extensions: [
          {
            entry: "src/index.ts",
            description: "Example extension",
            tools: [
              { name: "web_search", label: "Web Search", description: "Search the web" },
            ],
            commands: [{ name: "search", description: "Run a search" }],
            hooks: ["agent_start", "turn_end"],
            renderers: ["message"],
            flags: ["verbose"],
            shortcuts: ["search"],
          },
        ],
      },
    }),
  );

  const result = await resolveManagedExtensionEntries(root);
  assert.deepEqual(result.paths, [await realpath(entry)]);
  assert.deepEqual(result.surface, {
    description: "Example extension",
    tools: [
      { name: "web_search", label: "Web Search", description: "Search the web" },
    ],
    commands: [{ name: "search", description: "Run a search" }],
    hooks: ["agent_start", "turn_end"],
    renderers: ["message"],
    flags: ["verbose"],
    shortcuts: ["search"],
  });
});

test("structured entries may mix string and object entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-managed-mixed-"));
  const a = join(root, "a.ts");
  const b = join(root, "b.ts");
  await writeFile(a, "export default () => {}");
  await writeFile(b, "export default () => {}");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      pi: {
        extensions: [
          "a.ts",
          { entry: "b.ts", tools: [{ name: "tool_b" }] },
        ],
      },
    }),
  );

  const result = await resolveManagedExtensionEntries(root);
  assert.deepEqual(result.paths.sort(), [await realpath(a), await realpath(b)].sort());
  assert.deepEqual(result.surface.tools, [{ name: "tool_b" }]);
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
