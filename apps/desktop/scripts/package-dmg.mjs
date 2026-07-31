import { execFile as execFileCallback } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(
  desktopDir,
  "src-tauri/target/release/bundle/macos/Pi Desktop.app",
);
const outputPath = join(desktopDir, "artifacts/Pi-Desktop-arm64.dmg");

await access(appPath);
await mkdir(dirname(outputPath), { recursive: true });
await rm(outputPath, { force: true });

const staging = await mkdtemp(join(tmpdir(), "pi-desktop-dmg-"));
try {
  await cp(appPath, join(staging, "Pi Desktop.app"), {
    recursive: true,
    force: true,
    dereference: false,
  });
  await symlink("/Applications", join(staging, "Applications"));
  await execFile("diskutil", [
    "image",
    "create",
    "from",
    "--format",
    "UDZO",
    staging,
    outputPath,
  ]);
  console.log(`Created ${outputPath}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
