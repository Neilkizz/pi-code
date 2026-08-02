import type { ExtensionProfile, ExtensionSurface } from "@pi-desktop/protocol";

/** Parse `extension:<extensionId>:<toolName>` into its parts, or null. */
export function parseExtensionIdentity(
  toolName: string,
): { id: string; tool: string } | null {
  const match = /^extension:(.+):(.+)$/.exec(toolName);
  return match ? { id: match[1], tool: match[2] } : null;
}

/** Resolve a friendly label for an `extension:*` tool name from declared surfaces. */
export function extensionToolLabel(
  toolName: string,
  surfaces: (ExtensionSurface | undefined)[],
): string | null {
  const identity = parseExtensionIdentity(toolName);
  if (!identity) return null;
  for (const surface of surfaces) {
    if (!surface) continue;
    const tool = surface.tools.find((candidate) => candidate.name === identity.tool);
    if (tool) return tool.label ?? tool.name;
  }
  return null;
}

/** Whether a declared surface advertises anything beyond tools. */
export function hasNonToolSurface(
  surface: ExtensionSurface | undefined,
): boolean {
  if (!surface) return false;
  return (
    surface.commands.length > 0 ||
    surface.hooks.length > 0 ||
    surface.renderers.length > 0 ||
    surface.flags.length > 0 ||
    surface.shortcuts.length > 0
  );
}

/** Whether a profile declares any surface at all. */
export function hasDeclaredSurface(
  profile: ExtensionProfile | undefined,
): boolean {
  if (!profile?.surface) return false;
  const surface = profile.surface;
  return (
    surface.tools.length > 0 ||
    hasNonToolSurface(surface) ||
    Boolean(surface.description) ||
    Boolean(surface.icon)
  );
}
