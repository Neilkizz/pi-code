import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(
  desktopDir,
  "src-tauri/target/release/bundle/macos/Pi Desktop.app/Contents/Resources",
);
const node = join(resources, "runtime/node/bin/node");
const npm = join(
  resources,
  "runtime/node/lib/node_modules/npm/bin/npm-cli.js",
);
const host = join(resources, "runtime/pi-agent-host/dist/main.js");

await Promise.all([access(node), access(npm), access(host)]);
const appDataDir = await mkdtemp(join(tmpdir(), "pi-desktop-bundle-smoke-"));
const child = spawn(node, [host], {
  stdio: ["pipe", "pipe", "pipe"],
});
const messages = [];
const errors = [];
createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
  "line",
  (line) => {
    try {
      messages.push(JSON.parse(line));
    } catch {
      errors.push(`Non-JSON stdout: ${line}`);
    }
  },
);
createInterface({ input: child.stderr, crlfDelay: Infinity }).on(
  "line",
  (line) => errors.push(line),
);

try {
  child.stdin.write(
    `${JSON.stringify({
      protocolVersion: 2,
      messageId: "bundle-smoke-bootstrap",
      idempotencyKey: "bundle-smoke-bootstrap",
      timestamp: Date.now(),
      type: "host.bootstrap",
      appDataDir,
    })}\n`,
  );
  await waitUntil(
    () =>
      messages.some(
        (message) =>
          message.type === "response" &&
          message.correlationId === "bundle-smoke-bootstrap" &&
          message.ok === true,
      ),
    12_000,
  );
  const hello = messages.find((message) => message.type === "host.hello");
  const ready = messages.some(
    (message) =>
      message.type === "host.status" && message.state?.status === "ready",
  );
  if (
    hello?.protocolVersion !== 2 ||
    hello.hello?.selectedVersion !== 2 ||
    !/^\d+\.\d+\.\d+/.test(hello.hello?.hostVersion ?? "") ||
    !ready
  ) {
    throw new Error(
      `Bundled Pi Host handshake was incomplete: ${JSON.stringify(messages)}`,
    );
  }
  console.log(
    `Bundled Pi Host ready · protocol ${hello.hello.selectedVersion} · SDK ${hello.hello.hostVersion}`,
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2_000);
  });
  await rm(appDataDir, { recursive: true, force: true });
}

async function waitUntil(predicate, timeoutMs) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for bundled Pi Host${errors.length ? `:\n${errors.join("\n")}` : ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
