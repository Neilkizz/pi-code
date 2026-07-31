import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { ExtensionRuntimeConfig } from "@pi-desktop/protocol";
import type { BrokerClient } from "./broker-client.js";
import {
  appendBoundedLines,
  decodeAuthenticated,
  encodeAuthenticated,
} from "./extension-worker-protocol.js";
import type { PermissionGate } from "./permission-gate.js";

const RESERVED_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "ls",
  "bash",
  "grep",
  "find",
  "apply_patch",
]);
const START_TIMEOUT_MS = 10_000;
const INVOCATION_TIMEOUT_MS = 120_000;

export interface ManagedExtensionTool {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TSchema;
  executionMode?: "sequential" | "parallel";
}

export interface ManagedExtensionStartupFailure {
  extensionId: string;
  extensionName: string;
  message: string;
}

interface PendingInvocation {
  resolve: (result: AgentToolResult<unknown>) => void;
  reject: (error: Error) => void;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export class ManagedExtensionWorker {
  readonly tools: ManagedExtensionTool[] = [];
  readonly unsupported: string[] = [];

  private readonly secret = randomBytes(32).toString("hex");
  private readonly pending = new Map<string, PendingInvocation>();
  private child?: ChildProcessWithoutNullStreams;
  private outputBuffer = "";
  private nextSequence = 1;
  private ready = false;
  private disposed = false;

  private constructor(
    readonly config: ExtensionRuntimeConfig,
    private readonly cwd: string,
  ) {}

  static async start(
    config: ExtensionRuntimeConfig,
    cwd: string,
  ): Promise<ManagedExtensionWorker> {
    const worker = new ManagedExtensionWorker(config, cwd);
    await worker.launch();
    return worker;
  }

  invoke(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<unknown>,
  ): Promise<AgentToolResult<unknown>> {
    if (!this.ready || !this.child || this.disposed) {
      return Promise.reject(
        new Error(`Managed Extension '${this.config.name}' is not running`),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("Managed Extension tool was cancelled"));
    }
    const requestId = randomUUID();
    return new Promise((resolvePromise, rejectPromise) => {
      const abort = () => {
        this.send({ type: "cancel", requestId });
        this.settle(
          requestId,
          new Error("Managed Extension tool was cancelled"),
        );
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const timer = setTimeout(() => {
        this.settle(
          requestId,
          new Error("Managed Extension tool exceeded the 120 second limit"),
        );
        this.ready = false;
        this.child?.kill("SIGKILL");
      }, INVOCATION_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        onUpdate,
        timer,
        cleanup,
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send({
          type: "invoke",
          requestId,
          toolName,
          toolCallId,
          input,
        });
      } catch (error: unknown) {
        this.settle(
          requestId,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  dispose(reason = "Managed Extension Worker stopped"): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ready) {
      try {
        this.send({ type: "shutdown" });
      } catch {
        // The child may already be gone.
      }
    }
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.ready = false;
    this.rejectAll(new Error(reason));
  }

  private launch(): Promise<void> {
    const workerEntry = fileURLToPath(
      new URL("../extension-worker-main.js", import.meta.url),
    );
    const hostRoot = resolve(dirname(workerEntry), "..");
    const extensionPath = resolve(this.config.installPath);
    const extensionReadScope =
      this.config.integrityMode === "full-tree-v1"
        ? extensionPath
        : dirname(extensionPath);
    const child = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${hostRoot}`,
        `--allow-fs-read=${extensionReadScope}`,
        workerEntry,
      ],
      {
        cwd: extensionReadScope,
        env: {
          LANG: process.env.LANG ?? "en_US.UTF-8",
          LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          PI_DESKTOP_TASK_CWD: this.cwd,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;

    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let stderr = "";
      const timer = setTimeout(() => {
        finish(
          new Error(
            `Managed Extension '${this.config.name}' did not initialize within 10 seconds`,
          ),
        );
      }, START_TIMEOUT_MS);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.dispose(error.message);
          rejectPromise(error);
        } else {
          resolvePromise();
        }
      };

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-16_384);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        try {
          const parsed = appendBoundedLines(this.outputBuffer, chunk);
          this.outputBuffer = parsed.buffer;
          for (const line of parsed.lines) {
            const message = decodeAuthenticated(this.secret, line);
            if (message.type === "ready") {
              this.acceptManifest(message);
              this.ready = true;
              finish();
            } else {
              this.handleMessage(message);
            }
          }
        } catch (error: unknown) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        this.ready = false;
        this.rejectAll(
          new Error(
            `Managed Extension '${this.config.name}' exited (${signal ?? code ?? "unknown"})`,
          ),
        );
        if (!settled) {
          finish(
            new Error(
              `Managed Extension '${this.config.name}' failed to start: ${
                stderr.trim() || `exit ${code ?? signal ?? "unknown"}`
              }`,
            ),
          );
        }
      });

      child.stdin.write(
        `${JSON.stringify({
          type: "initialize",
          secret: this.secret,
          extension: this.config,
          cwd: this.cwd,
        })}\n`,
      );
    });
  }

  private acceptManifest(message: Record<string, unknown>): void {
    if (message.extensionId !== this.config.id || !Array.isArray(message.tools)) {
      throw new Error("Managed Extension returned an invalid manifest");
    }
    for (const candidate of message.tools) {
      if (!isTool(candidate)) {
        throw new Error("Managed Extension returned an invalid tool definition");
      }
      if (RESERVED_TOOL_NAMES.has(candidate.name)) {
        throw new Error(
          `Managed Extension '${this.config.name}' attempts to override reserved tool '${candidate.name}'`,
        );
      }
      this.tools.push({
        ...candidate,
        parameters: Type.Unsafe(candidate.parameters),
      });
    }
    if (Array.isArray(message.unsupported)) {
      this.unsupported.push(
        ...message.unsupported.filter(
          (value): value is string => typeof value === "string",
        ),
      );
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message.type === "fatal") {
      const error = new Error(
        typeof message.error === "string"
          ? message.error
          : "Managed Extension Worker failed",
      );
      this.rejectAll(error);
      this.child?.kill("SIGTERM");
      return;
    }
    const requestId =
      typeof message.requestId === "string" ? message.requestId : "";
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (message.type === "update") {
      pending.onUpdate?.(message.update as never);
      return;
    }
    if (message.type === "result") {
      if (message.ok === true) {
        this.settle(
          requestId,
          undefined,
          message.result as AgentToolResult<unknown>,
        );
      } else {
        this.settle(
          requestId,
          new Error(
            typeof message.error === "string"
              ? message.error
              : "Managed Extension tool failed",
          ),
        );
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) {
      throw new Error(`Managed Extension '${this.config.name}' is unavailable`);
    }
    this.child.stdin.write(
      encodeAuthenticated(this.secret, {
        ...payload,
        sequence: this.nextSequence++,
      }),
    );
  }

  private settle(
    requestId: string,
    error?: Error,
    result?: AgentToolResult<unknown>,
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.cleanup();
    if (error) pending.reject(error);
    else pending.resolve(result as AgentToolResult<unknown>);
  }

  private rejectAll(error: Error): void {
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, error);
    }
  }
}

export async function startManagedExtensionWorkers(
  configs: ExtensionRuntimeConfig[],
  cwd: string,
  onFailure: (failure: ManagedExtensionStartupFailure) => void = () => undefined,
): Promise<ManagedExtensionWorker[]> {
  const workers: ManagedExtensionWorker[] = [];
  const names = new Map<string, string>();
  for (const config of configs) {
    let worker: ManagedExtensionWorker;
    try {
      worker = await ManagedExtensionWorker.start(config, cwd);
    } catch (error: unknown) {
      onFailure({
        extensionId: config.id,
        extensionName: config.name,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const duplicate = worker.tools.find((tool) => names.has(tool.name));
    if (duplicate) {
      const owner = names.get(duplicate.name) as string;
      const message = `Managed Extensions '${owner}' and '${worker.config.name}' both register tool '${duplicate.name}'`;
      worker.dispose(message);
      onFailure({
        extensionId: config.id,
        extensionName: config.name,
        message,
      });
      continue;
    }
    for (const tool of worker.tools) {
      names.set(tool.name, worker.config.name);
    }
    workers.push(worker);
  }
  return workers;
}

export function createManagedExtensionTools(
  workers: ManagedExtensionWorker[],
  gate: PermissionGate,
  client: BrokerClient,
): InlineExtension {
  return {
    name: "desktop-managed-extension-proxies",
    hidden: true,
    factory: (pi) => {
      for (const worker of workers) {
        for (const tool of worker.tools) {
          gate.registerManagedTool(tool.name);
          pi.registerTool({
            ...tool,
            execute(toolCallId, input, signal, onUpdate) {
              const toolInput = input as Record<string, unknown>;
              const identity = `extension:${worker.config.id}:${tool.name}`;
              return authorizeManagedInvocation(
                gate,
                client,
                worker,
                identity,
                tool.name,
                toolCallId,
                toolInput,
                signal,
                onUpdate,
              );
            },
          });
        }
      }
    },
  };
}

async function authorizeManagedInvocation(
  gate: PermissionGate,
  client: BrokerClient,
  worker: ManagedExtensionWorker,
  identity: string,
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<unknown>,
): Promise<AgentToolResult<unknown>> {
  const approvalId = await gate.authorize(identity, input, signal);
  return client.withToolContext(
    { toolName: identity, toolInput: input, approvalId },
    async () => {
      await client.request(
        "extension.invoke",
        {
          extensionId: worker.config.id,
          contentHash: worker.config.contentHash,
          toolName,
        },
        signal,
      );
      return worker.invoke(toolName, toolCallId, input, signal, onUpdate);
    },
  );
}

function isTool(value: unknown): value is ManagedExtensionTool {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ManagedExtensionTool>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.label === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.parameters === "object" &&
    candidate.parameters !== null
  );
}
