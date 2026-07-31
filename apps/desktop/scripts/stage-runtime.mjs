import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = resolve(desktopDir, "../..");
const hostDir = join(projectDir, "packages/pi-agent-host");
const runtimeDir = join(desktopDir, "src-tauri/runtime");
const targetNodeRoot = join(runtimeDir, "node");
const targetNode = join(runtimeDir, "node/bin/node");
const targetNpm = join(
  runtimeDir,
  "node/lib/node_modules/npm/bin/npm-cli.js",
);
const targetHost = join(runtimeDir, "pi-agent-host");
const execFile = promisify(execFileCallback);
const officialNode = {
  version: "25.6.1",
  darwinArm64Sha256:
    "d5c37f04d4006741574730871148839f254f3b3940f5afd70f7d1e70970c90e3",
};

if (process.platform !== "darwin") {
  throw new Error(`macOS runtime staging requires darwin, received ${process.platform}`);
}
if (process.arch !== "arm64") {
  throw new Error(`This release staging target requires arm64, received ${process.arch}`);
}

await requirePath(join(hostDir, "dist/main.js"), "Run the Pi Host build first.");
await requirePath(join(hostDir, "node_modules"), "Install Pi Host dependencies first.");
const sourceNodeRoot = await resolveNodeRuntime();
const sourceNode = join(sourceNodeRoot, "bin/node");
const sourceNpmRoot = join(sourceNodeRoot, "lib/node_modules/npm");
await requirePath(sourceNode, "Set PI_DESKTOP_NODE_BINARY to a valid Node binary.");
await requirePath(
  join(sourceNpmRoot, "bin/npm-cli.js"),
  "The official npm client is required for managed Pi package updates.",
);
await assertPortableNode(sourceNode);

await rm(targetNodeRoot, { recursive: true, force: true });
await rm(targetHost, { recursive: true, force: true });
await mkdir(dirname(targetNode), { recursive: true });
await mkdir(targetHost, { recursive: true });
await copyFile(sourceNode, targetNode);
await chmod(targetNode, 0o755);
await cp(sourceNpmRoot, join(targetNodeRoot, "lib/node_modules/npm"), {
  recursive: true,
  force: true,
  dereference: true,
});
await cp(join(hostDir, "dist"), join(targetHost, "dist"), {
  recursive: true,
  force: true,
});
for (const dependency of [
  "@earendil-works/pi-coding-agent",
  "@pi-desktop/protocol",
  "typebox",
]) {
  const source = join(hostDir, "node_modules", dependency);
  const target = join(targetHost, "node_modules", dependency);
  await requirePath(source, `Production dependency ${dependency} is unavailable.`);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    dereference: true,
  });
}
await copyFile(join(hostDir, "package.json"), join(targetHost, "package.json"));

console.log(`Staged ${process.arch} Node runtime at ${targetNode}`);
console.log(`Staged bundled npm client at ${targetNpm}`);
console.log(`Staged Pi Host runtime at ${targetHost}`);

async function resolveNodeRuntime() {
  if (process.env.PI_DESKTOP_NODE_RUNTIME_DIR) {
    return resolve(process.env.PI_DESKTOP_NODE_RUNTIME_DIR);
  }
  if (process.env.PI_DESKTOP_NODE_BINARY) {
    const runtimeRoot = resolve(dirname(process.env.PI_DESKTOP_NODE_BINARY), "..");
    await requirePath(
      join(runtimeRoot, "lib/node_modules/npm/bin/npm-cli.js"),
      "Use PI_DESKTOP_NODE_RUNTIME_DIR when supplying a custom runtime.",
    );
    return runtimeRoot;
  }

  const basename = `node-v${officialNode.version}-darwin-arm64`;
  const cacheDir = join(desktopDir, ".runtime-cache");
  const cachedRoot = join(cacheDir, basename);
  const cachedNode = join(cachedRoot, "bin/node");
  const cachedNpm = join(cachedRoot, "lib/node_modules/npm/bin/npm-cli.js");
  try {
    await access(cachedNode, constants.R_OK);
    await access(cachedNpm, constants.R_OK);
    return cachedRoot;
  } catch {
    // Continue with a verified official download.
  }

  await mkdir(cacheDir, { recursive: true });
  const archive = join(cacheDir, `${basename}.tar.xz`);
  const url = `https://nodejs.org/dist/v${officialNode.version}/${basename}.tar.xz`;
  let archiveBytes;
  try {
    archiveBytes = await readFile(archive);
  } catch {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Official Node runtime download failed: HTTP ${response.status}`);
    }
    archiveBytes = Buffer.from(await response.arrayBuffer());
    await writeFile(`${archive}.tmp`, archiveBytes, { mode: 0o600 });
    await rename(`${archive}.tmp`, archive);
  }

  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  if (digest !== officialNode.darwinArm64Sha256) {
    await rm(archive, { force: true });
    throw new Error(
      `Official Node runtime checksum mismatch: expected ${officialNode.darwinArm64Sha256}, received ${digest}`,
    );
  }

  const extractionDir = join(cacheDir, `${basename}.extracting`);
  await rm(extractionDir, { recursive: true, force: true });
  await mkdir(extractionDir, { recursive: true });
  await execFile("tar", ["-xJf", archive, "-C", extractionDir]);
  const extractedNode = join(extractionDir, basename, "bin/node");
  const extractedNpm = join(extractionDir, basename, "lib/node_modules/npm");
  await requirePath(extractedNode, `Archive ${url} did not contain bin/node.`);
  await requirePath(
    join(extractedNpm, "bin/npm-cli.js"),
    `Archive ${url} did not contain npm.`,
  );
  await rm(cachedRoot, { recursive: true, force: true });
  await mkdir(join(cachedRoot, "bin"), { recursive: true });
  await copyFile(extractedNode, cachedNode);
  await chmod(cachedNode, 0o755);
  await cp(extractedNpm, join(cachedRoot, "lib/node_modules/npm"), {
    recursive: true,
    force: true,
    dereference: true,
  });
  await rm(extractionDir, { recursive: true, force: true });
  return cachedRoot;
}

async function assertPortableNode(path) {
  const { stdout } = await execFile("otool", ["-L", path]);
  const nonPortable = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("/opt/homebrew/") || line.startsWith("/usr/local/"),
    );
  if (nonPortable.length > 0) {
    throw new Error(
      `Node runtime has machine-local dynamic library dependencies:\n${nonPortable.join("\n")}`,
    );
  }
}

async function requirePath(path, help) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${path} is unavailable. ${help}`);
  }
}
