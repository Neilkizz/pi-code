import {
  DefaultResourceLoader,
  SettingsManager,
  type InlineExtension,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CONTEXT_FILES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const MAX_CONTEXT_BYTES = 512 * 1024;

export async function createDesktopResourceLoader(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  extensionFactories?: InlineExtension[];
  projectInstructions?: string;
}): Promise<ResourceLoader> {
  const scopedContext = await loadScopedContext(options.cwd);
  if (options.projectInstructions?.trim()) {
    scopedContext.unshift(
      `Pi Desktop project instructions (user-managed):\n\n${options.projectInstructions.trim()}`,
    );
  }
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager,
    // Third-party code is loaded only by restricted Managed Extension
    // Workers. Pi Host receives authenticated proxy tools, never source paths.
    additionalExtensionPaths: [],
    extensionFactories: options.extensionFactories,
    noExtensions: true,
    // Native skills/prompt templates are discovered from agentDir/skills and
    // agentDir/prompts, where the desktop resource manager writes enabled
    // user resources (so they gain SDK-native /skill: and prompt semantics).
    noSkills: false,
    noPromptTemplates: false,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: scopedContext,
  });

  await loader.reload();
  return loader;
}

async function loadScopedContext(cwd: string): Promise<string[]> {
  for (const filename of CONTEXT_FILES) {
    try {
      const content = await readFile(join(cwd, filename));
      if (content.byteLength > MAX_CONTEXT_BYTES) {
        throw new Error(
          `${filename} exceeds the ${MAX_CONTEXT_BYTES} byte context limit`,
        );
      }
      return [
        `Project instructions from ${filename}:\n\n${content.toString("utf8")}`,
      ];
    } catch (error: unknown) {
      if (isMissing(error)) continue;
      throw error;
    }
  }
  return [];
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
