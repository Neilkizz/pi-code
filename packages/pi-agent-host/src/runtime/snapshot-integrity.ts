import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const MAX_SCANNABLE_FILES = 200;
const MAX_SCANNABLE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_FILES = 20_000;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;

export async function hashFullSnapshot(input: string): Promise<string> {
  const source = await realpath(input);
  const metadata = await stat(source);
  if (!metadata.isDirectory()) {
    throw new Error("Managed package snapshot must be a directory");
  }
  const files = await collectAllFiles(source);
  if (files.length === 0) {
    throw new Error("Managed package snapshot contains no files");
  }
  return hashFiles(source, files, MAX_PACKAGE_BYTES);
}

export async function hashScannableSnapshot(input: string): Promise<string> {
  const source = await realpath(input);
  const metadata = await stat(source);
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new Error("Managed Extension snapshot must be a file or directory");
  }
  const root = metadata.isDirectory() ? source : resolve(source, "..");
  const files = metadata.isFile() ? [source] : await collectScannableFiles(source);
  if (files.length === 0) {
    throw new Error("Managed Extension snapshot contains no supported files");
  }
  return hashFiles(root, files, MAX_SCANNABLE_BYTES);
}

async function hashFiles(
  root: string,
  files: string[],
  maximumBytes: number,
): Promise<string> {
  const digest = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    const fileMetadata = await lstat(file);
    if (fileMetadata.isSymbolicLink()) continue;
    totalBytes += fileMetadata.size;
    if (totalBytes > maximumBytes) {
      throw new Error(
        `Managed Extension snapshot exceeds the ${maximumBytes} byte limit`,
      );
    }
    digest.update(relative(root, file));
    digest.update(Buffer.from([0]));
    digest.update(await readFile(file));
  }
  return digest.digest("hex");
}

async function collectAllFiles(root: string): Promise<string[]> {
  return collectTreeFiles(root, () => true, MAX_PACKAGE_FILES);
}

async function collectScannableFiles(root: string): Promise<string[]> {
  return collectTreeFiles(root, isScannable, MAX_SCANNABLE_FILES, true);
}

async function collectTreeFiles(
  root: string,
  include: (path: string) => boolean,
  maximumFiles: number,
  skipGeneratedDirectories = false,
): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (
        skipGeneratedDirectories &&
        entry.isDirectory() &&
        [".git", "node_modules", "dist", "coverage"].includes(entry.name)
      ) {
        continue;
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isSymbolicLink() || include(path)) {
        files.push(path);
        if (files.length > maximumFiles) {
          throw new Error(
            `Managed Extension snapshot exceeds the ${maximumFiles} file limit`,
          );
        }
      }
    }
  }
  await walk(root);

  // Keep the depth-first, component-wise order produced above. Rust PathBuf
  // ordering compares path components, while sorting complete JavaScript path
  // strings places e.g. "a-file" before "a/file" and changes the digest.
  return files;
}

function isScannable(path: string): boolean {
  return /\.(?:js|mjs|cjs|ts|tsx|json|md)$/.test(basename(path));
}
