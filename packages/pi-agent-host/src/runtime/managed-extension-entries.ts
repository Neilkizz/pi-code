import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const MAX_EXTENSION_ENTRIES = 64;
const SUPPORTED_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

export async function resolveManagedExtensionEntries(
  input: string,
): Promise<string[]> {
  const source = await realpath(input);
  const metadata = await stat(source);
  if (metadata.isFile()) {
    assertExtensionFile(source);
    return [source];
  }
  if (!metadata.isDirectory()) {
    throw new Error("Managed Extension path must be a file or directory");
  }

  const manifestEntries = await readManifestEntries(source);
  if (manifestEntries) {
    return resolveEntries(source, manifestEntries);
  }

  for (const filename of ["index.ts", "index.js", "index.mjs", "index.cjs"]) {
    const candidate = join(source, filename);
    if (await isFile(candidate)) {
      return [await realpath(candidate)];
    }
  }

  const entries = await readdir(source, { withFileTypes: true });
  const directFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name)),
    )
    .map((entry) => entry.name)
    .sort();
  if (directFiles.length === 0) {
    throw new Error(
      "Managed Extension directory has no pi.extensions manifest or extension entry file",
    );
  }
  return resolveEntries(source, directFiles);
}

async function readManifestEntries(root: string): Promise<string[] | undefined> {
  const manifestPath = join(root, "package.json");
  if (!(await isFile(manifestPath))) {
    return undefined;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    pi?: { extensions?: unknown };
  };
  const entries = manifest.pi?.extensions;
  if (entries === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    entries.length > MAX_EXTENSION_ENTRIES ||
    entries.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error("Managed Extension pi.extensions manifest is invalid");
  }
  return entries as string[];
}

async function resolveEntries(
  root: string,
  entries: string[],
): Promise<string[]> {
  const rootPrefix = `${root}${sep}`;
  const resolved: string[] = [];
  for (const entry of entries) {
    const candidate = await realpath(resolve(root, entry));
    if (!candidate.startsWith(rootPrefix)) {
      throw new Error(
        `Managed Extension entry escapes its quarantine snapshot: ${entry}`,
      );
    }
    const metadata = await stat(candidate);
    if (!metadata.isFile()) {
      throw new Error(`Managed Extension entry is not a file: ${entry}`);
    }
    assertExtensionFile(candidate);
    if (!resolved.includes(candidate)) {
      resolved.push(candidate);
    }
  }
  return resolved;
}

function assertExtensionFile(path: string): void {
  if (!SUPPORTED_EXTENSIONS.has(extname(path))) {
    throw new Error(`Unsupported managed Extension entry: ${path}`);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
