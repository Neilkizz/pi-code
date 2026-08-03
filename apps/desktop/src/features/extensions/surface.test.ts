import { describe, expect, it } from "vitest";
import type { ExtensionProfile, ExtensionSurface } from "@pi-desktop/protocol";
import {
  extensionToolLabel,
  hasDeclaredSurface,
  hasNonToolSurface,
  parseExtensionIdentity,
} from "./surface";

const surface: ExtensionSurface = {
  tools: [
    { name: "web_search", label: "Web Search", description: "Search the web" },
    { name: "bare_tool" },
  ],
  commands: [{ name: "search" }],
  hooks: ["agent_start"],
  renderers: [],
  flags: [],
  shortcuts: [],
};

describe("parseExtensionIdentity", () => {
  it("parses extension:<id>:<tool>", () => {
    expect(parseExtensionIdentity("extension:abc-123:web_search")).toEqual({
      id: "abc-123",
      tool: "web_search",
    });
  });

  it("returns null for non-extension tools", () => {
    expect(parseExtensionIdentity("read")).toBeNull();
  });
});

describe("extensionToolLabel", () => {
  it("resolves a friendly label from declared surfaces", () => {
    expect(
      extensionToolLabel("extension:abc-123:web_search", [surface]),
    ).toBe("Web Search");
  });

  it("falls back to the raw tool name when no label is declared", () => {
    expect(extensionToolLabel("extension:abc-123:bare_tool", [surface])).toBe(
      "bare_tool",
    );
  });

  it("returns null for unknown tools or missing surfaces", () => {
    expect(extensionToolLabel("extension:abc-123:unknown", [surface])).toBeNull();
    expect(extensionToolLabel("read", [surface])).toBeNull();
  });
});

describe("hasNonToolSurface", () => {
  it("detects commands/hooks/renderers beyond tools", () => {
    expect(hasNonToolSurface(surface)).toBe(true);
    expect(
      hasNonToolSurface({ ...surface, commands: [], hooks: [], renderers: [], flags: [], shortcuts: [] }),
    ).toBe(false);
  });
});

describe("hasDeclaredSurface", () => {
  const profile = { surface } as unknown as ExtensionProfile;
  const bare = {
    surface: {
      tools: [],
      commands: [],
      hooks: [],
      renderers: [],
      flags: [],
      shortcuts: [],
    },
  } as unknown as ExtensionProfile;

  it("is true when the surface declares tools or non-tool capabilities", () => {
    expect(hasDeclaredSurface(profile)).toBe(true);
  });

  it("is false for an empty surface or a missing one", () => {
    expect(hasDeclaredSurface(bare)).toBe(false);
    expect(hasDeclaredSurface(undefined)).toBe(false);
  });
});
