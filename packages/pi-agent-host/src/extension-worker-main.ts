import { randomUUID } from "node:crypto";
import {
  type AgentToolResult,
  type ExtensionContext,
  type RegisteredTool,
} from "@earendil-works/pi-coding-agent";
// The public discovery helper probes project-local extension directories,
// which a restricted Worker must not be allowed to read. This pinned internal
// loader loads only the exact Core-verified quarantine snapshot.
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import {
  appendBoundedLines,
  decodeAuthenticated,
  encodeAuthenticated,
} from "./runtime/extension-worker-protocol.js";
import { resolveManagedExtensionEntries } from "./runtime/managed-extension-entries.js";
import {
  hashFullSnapshot,
  hashScannableSnapshot,
} from "./runtime/snapshot-integrity.js";

interface WorkerBootstrap {
  type: "initialize";
  secret: string;
  extension: {
    id: string;
    name: string;
    installPath: string;
    contentHash: string;
    integrityMode: "scannable-v1" | "full-tree-v1";
  };
  cwd: string;
}

const rawWrite = process.stdout.write.bind(process.stdout);
const tools = new Map<string, RegisteredTool>();
const controllers = new Map<string, AbortController>();
let secret = "";
let expectedSequence = 1;
let inputBuffer = "";
let initialized = false;

process.stdin.on("data", (chunk: Buffer) => {
  try {
    const parsed = appendBoundedLines(inputBuffer, chunk);
    inputBuffer = parsed.buffer;
    for (const line of parsed.lines) {
      if (!initialized) {
        initialized = true;
        void initialize(JSON.parse(line) as WorkerBootstrap);
      } else {
        void handleAuthenticated(line);
      }
    }
  } catch (error: unknown) {
    failAndExit(error);
  }
});
process.stdin.resume();

async function initialize(bootstrap: WorkerBootstrap): Promise<void> {
  if (
    bootstrap.type !== "initialize" ||
    typeof bootstrap.secret !== "string" ||
    bootstrap.secret.length < 32 ||
    !bootstrap.extension?.installPath ||
    !bootstrap.cwd
  ) {
    throw new Error("Managed Extension bootstrap is invalid");
  }
  secret = bootstrap.secret;
  const actualHash =
    bootstrap.extension.integrityMode === "full-tree-v1"
      ? await hashFullSnapshot(bootstrap.extension.installPath)
      : await hashScannableSnapshot(bootstrap.extension.installPath);
  if (actualHash !== bootstrap.extension.contentHash) {
    throw new Error(
      `Managed Extension snapshot hash mismatch: expected ${bootstrap.extension.contentHash}, received ${actualHash}`,
    );
  }

  const extensionEntries = await resolveManagedExtensionEntries(
    bootstrap.extension.installPath,
  );
  const result = await loadExtensions(extensionEntries, bootstrap.cwd);
  if (result.errors.length > 0) {
    throw new Error(
      result.errors
        .map((failure) => `${failure.path}: ${failure.error}`)
        .join("; "),
    );
  }

  const unsupported = new Set<string>();
  for (const extension of result.extensions) {
    for (const [name, tool] of extension.tools) {
      if (tools.has(name)) {
        throw new Error(`Extension registers duplicate tool '${name}'`);
      }
      tools.set(name, tool);
    }
    if ([...extension.handlers.values()].some((handlers) => handlers.length > 0)) {
      unsupported.add("event hooks");
    }
    if (extension.commands.size > 0) unsupported.add("commands");
    if (extension.flags.size > 0) unsupported.add("flags");
    if (extension.shortcuts.size > 0) unsupported.add("shortcuts");
    if (extension.messageRenderers.size > 0) unsupported.add("message renderers");
    if ((extension.entryRenderers?.size ?? 0) > 0) {
      unsupported.add("entry renderers");
    }
  }

  send({
    type: "ready",
    extensionId: bootstrap.extension.id,
    tools: [...tools.values()].map(({ definition }) => ({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      promptSnippet: definition.promptSnippet,
      promptGuidelines: definition.promptGuidelines,
      parameters: cloneSerializable(definition.parameters),
      executionMode: definition.executionMode,
    })),
    unsupported: [...unsupported],
  });
}

async function handleAuthenticated(line: string): Promise<void> {
  const message = decodeAuthenticated(secret, line);
  const sequence = numberField(message, "sequence");
  if (sequence !== expectedSequence) {
    throw new Error(
      `Managed Extension input sequence mismatch: expected ${expectedSequence}, received ${sequence}`,
    );
  }
  expectedSequence += 1;

  if (message.type === "invoke") {
    const requestId = stringField(message, "requestId");
    const toolName = stringField(message, "toolName");
    const toolCallId = stringField(message, "toolCallId");
    const input = recordField(message, "input");
    const tool = tools.get(toolName);
    if (!tool) {
      send({
        type: "result",
        requestId,
        ok: false,
        error: `Unknown managed Extension tool: ${toolName}`,
      });
      return;
    }
    const controller = new AbortController();
    controllers.set(requestId, controller);
    try {
      const result = await tool.definition.execute(
        toolCallId,
        input,
        controller.signal,
        (update) => {
          send({
            type: "update",
            requestId,
            update: cloneSerializable(update),
          });
        },
        createRestrictedContext(controller.signal),
      );
      send({
        type: "result",
        requestId,
        ok: true,
        result: cloneSerializable(result),
      });
    } catch (error: unknown) {
      send({
        type: "result",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      controllers.delete(requestId);
    }
    return;
  }

  if (message.type === "cancel") {
    controllers.get(stringField(message, "requestId"))?.abort();
    return;
  }

  if (message.type === "shutdown") {
    for (const controller of controllers.values()) controller.abort();
    process.exit(0);
  }

  throw new Error(`Unknown Managed Extension message: ${String(message.type)}`);
}

function createRestrictedContext(signal: AbortSignal): ExtensionContext {
  const unavailable = () => {
    throw new Error(
      "This Pi API is unavailable inside a Managed Extension Worker; use a brokered tool capability",
    );
  };
  return {
    ui: new Proxy(
      {},
      {
        get: () => unavailable,
      },
    ) as ExtensionContext["ui"],
    mode: "rpc",
    hasUI: false,
    cwd: process.env.PI_DESKTOP_TASK_CWD ?? "",
    sessionManager: new Proxy(
      {},
      { get: () => unavailable },
    ) as ExtensionContext["sessionManager"],
    modelRegistry: new Proxy(
      {},
      { get: () => unavailable },
    ) as ExtensionContext["modelRegistry"],
    model: undefined,
    scopedModels: [],
    isIdle: () => true,
    isProjectTrusted: () => false,
    signal,
    abort: unavailable,
    hasPendingMessages: () => false,
    shutdown: unavailable,
    getContextUsage: () => undefined,
    compact: unavailable,
    getSystemPrompt: () => "",
  };
}

function send(payload: Record<string, unknown>): void {
  rawWrite(encodeAuthenticated(secret, payload));
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function failAndExit(error: unknown): void {
  if (secret) {
    try {
      send({
        type: "fatal",
        error: error instanceof Error ? error.message : String(error),
        crashId: randomUUID(),
      });
    } catch {
      // The authenticated channel itself may be the failure source.
    }
  }
  process.exitCode = 1;
}

function stringField(
  value: Record<string, unknown>,
  field: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`Managed Extension message requires ${field}`);
  }
  return candidate;
}

function numberField(
  value: Record<string, unknown>,
  field: string,
): number {
  const candidate = value[field];
  if (!Number.isSafeInteger(candidate) || (candidate as number) < 1) {
    throw new Error(`Managed Extension message requires a positive ${field}`);
  }
  return candidate as number;
}

function recordField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const candidate = value[field];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new Error(`Managed Extension message requires object ${field}`);
  }
  return candidate as Record<string, unknown>;
}
