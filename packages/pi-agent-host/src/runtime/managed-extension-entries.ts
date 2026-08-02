import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const MAX_EXTENSION_ENTRIES = 64;
const SUPPORTED_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

export interface PiExtensionToolDecl {
  name: string;
  label?: string;
  description?: string;
}

export interface PiExtensionCommandDecl {
  name: string;
  description?: string;
}

export interface PiExtensionEntry {
  entry: string;
  description?: string;
  icon?: string;
  tools?: PiExtensionToolDecl[];
  commands?: PiExtensionCommandDecl[];
  hooks?: string[];
  renderers?: string[];
  flags?: string[];
  shortcuts?: string[];
}

/** Declared extension surface (from the pi.extensions manifest). */
export interface ExtensionDeclaredSurface {
  description?: string;
  icon?: string;
  tools: PiExtensionToolDecl[];
  commands: PiExtensionCommandDecl[];
  hooks: string[];
  renderers: string[];
  flags: string[];
  shortcuts: string[];
}

export async function resolveManagedExtensionEntries(
  input: string,
): Promise<{ paths: string[]; surface: ExtensionDeclaredSurface }> {
  const source = await realpath(input);
  const metadata = await stat(source);
  if (metadata.isFile()) {
    assertExtensionFile(source);
    return { paths: [source], surface: emptySurface() };
  }
  if (!metadata.isDirectory()) {
    throw new Error("Managed Extension path must be a file or directory");
  }

  const manifestEntries = await readManifestEntries(source);
  if (manifestEntries) {
    const surface = mergeDeclaredSurface(manifestEntries);
    return {
      paths: await resolveEntries(source, manifestEntries.map((entry) => entry.entry)),
      surface,
    };
  }

  for (const filename of ["index.ts", "index.js", "index.mjs", "index.cjs"]) {
    const candidate = join(source, filename);
    if (await isFile(candidate)) {
      return {
        paths: [await realpath(candidate)],
        surface: emptySurface(),
      };
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
  return {
    paths: await resolveEntries(source, directFiles),
    surface: emptySurface(),
  };
}

async function readManifestEntries(
  root: string,
): Promise<PiExtensionEntry[] | undefined> {
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
    entries.length > MAX_EXTENSION_ENTRIES
  ) {
    throw new Error("Managed Extension pi.extensions manifest is invalid");
  }
  return entries.map(normalizeManifestEntry);
}

function normalizeManifestEntry(value: unknown): PiExtensionEntry {
  if (typeof value === "string") {
    if (!value.trim()) {
      throw new Error("Managed Extension pi.extensions entry cannot be empty");
    }
    return { entry: value };
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Managed Extension pi.extensions entry must be a path or object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.entry !== "string" || !record.entry.trim()) {
    throw new Error("Managed Extension pi.extensions object entry requires a string entry");
  }
  return {
    entry: record.entry,
    description: optionalString(record.description),
    icon: optionalString(record.icon),
    tools: optionalArray(record.tools).map(normalizeTool),
    commands: optionalArray(record.commands).map(normalizeCommand),
    hooks: optionalStringArray(record.hooks),
    renderers: optionalStringArray(record.renderers),
    flags: optionalStringArray(record.flags),
    shortcuts: optionalStringArray(record.shortcuts),
  };
}

function normalizeTool(value: unknown): PiExtensionToolDecl {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>).name !== "string") {
    throw new Error("Managed Extension tool declaration requires a name");
  }
  const record = value as Record<string, unknown>;
  const label = optionalString(record.label);
  const description = optionalString(record.description);
  return {
    name: record.name as string,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizeCommand(value: unknown): PiExtensionCommandDecl {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>).name !== "string") {
    throw new Error("Managed Extension command declaration requires a name");
  }
  const record = value as Record<string, unknown>;
  const description = optionalString(record.description);
  return {
    name: record.name as string,
    ...(description ? { description } : {}),
  };
}

function mergeDeclaredSurface(entries: PiExtensionEntry[]): ExtensionDeclaredSurface {
  const surface: ExtensionDeclaredSurface = emptySurface();
  for (const entry of entries) {
    if (surface.description === undefined && entry.description !== undefined) {
      surface.description = entry.description;
    }
    if (surface.icon === undefined && entry.icon !== undefined) {
      surface.icon = entry.icon;
    }
    surface.tools.push(...(entry.tools ?? []));
    surface.commands.push(...(entry.commands ?? []));
    surface.hooks.push(...(entry.hooks ?? []));
    surface.renderers.push(...(entry.renderers ?? []));
    surface.flags.push(...(entry.flags ?? []));
    surface.shortcuts.push(...(entry.shortcuts ?? []));
  }
  return surface;
}

function emptySurface(): ExtensionDeclaredSurface {
  return {
    tools: [],
    commands: [],
    hooks: [],
    renderers: [],
    flags: [],
    shortcuts: [],
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
