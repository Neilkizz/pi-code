import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDesktopCommand,
  type DesktopToHostMessage,
  type DesktopTaskState,
  type EndpointRuntimeConfig,
  type ExtensionRuntimeConfig,
  type HostToDesktopMessage,
} from "@pi-desktop/protocol";

const MAX_WORKER_LINE_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface TaskWorkerLaunch {
  appDataDir: string;
  task: Extract<DesktopToHostMessage, { type: "task.create" }>;
  endpoints: EndpointRuntimeConfig[];
  extensions: ExtensionRuntimeConfig[];
  onEvent: (message: HostToDesktopMessage) => void;
  onExit: (error: Error) => void;
}

export class TaskWorkerProxy {
  taskState?: DesktopTaskState;
  private readonly pending = new Map<string, PendingCommand>();
  private child?: ChildProcessWithoutNullStreams;
  private outputBuffer = "";
  private stderr = "";
  private disposed = false;
  private expectedExit = false;

  private constructor(private readonly launch: TaskWorkerLaunch) {}

  static async start(launch: TaskWorkerLaunch): Promise<TaskWorkerProxy> {
    const proxy = new TaskWorkerProxy(launch);
    await proxy.spawnAndInitialize();
    return proxy;
  }

  request(message: DesktopToHostMessage): Promise<unknown> {
    if (this.disposed || !this.child?.stdin.writable) {
      return Promise.reject(
        new Error(`Pi Worker for task ${this.launch.task.taskId} is unavailable`),
      );
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.messageId);
        rejectPromise(
          new Error(`Pi Worker command '${message.type}' timed out`),
        );
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(message.messageId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      try {
        this.write(message);
      } catch (error: unknown) {
        clearTimeout(timer);
        this.pending.delete(message.messageId);
        rejectPromise(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  send(message: DesktopToHostMessage): void {
    if (this.disposed || !this.child?.stdin.writable) {
      throw new Error(
        `Pi Worker for task ${this.launch.task.taskId} is unavailable`,
      );
    }
    this.write(message);
  }

  async configure(
    endpoints: EndpointRuntimeConfig[],
    extensions: ExtensionRuntimeConfig[],
  ): Promise<void> {
    await this.request(
      createDesktopCommand({
        type: "host.configureEndpoints",
        endpoints,
      }),
    );
    await this.request(
      createDesktopCommand({
        type: "host.configureExtensions",
        extensions,
      }),
    );
  }

  dispose(reason = "Pi Task Worker stopped"): void {
    if (this.disposed) return;
    this.disposed = true;
    this.expectedExit = true;
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.rejectAll(new Error(reason));
  }

  private async spawnAndInitialize(): Promise<void> {
    const workerEntry = fileURLToPath(
      new URL("../worker-main.js", import.meta.url),
    );
    const hostRoot = resolve(dirname(workerEntry), "..");
    const protocolRoot = resolve(
      dirname(fileURLToPath(import.meta.resolve("@pi-desktop/protocol"))),
      "..",
    );
    const cwd = resolve(this.launch.task.cwd);
    const appDataDir = resolve(this.launch.appDataDir);
    const runtimeHome = resolve(
      appDataDir,
      "runtime-home",
      this.launch.task.taskId,
    );
    const runtimeTmp = resolve(runtimeHome, "tmp");
    mkdirSync(runtimeTmp, { recursive: true, mode: 0o700 });
    const child = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${hostRoot}`,
        `--allow-fs-read=${protocolRoot}`,
        `--allow-fs-read=${appDataDir}`,
        `--allow-fs-read=${cwd}`,
        ...gitProbePermissions(cwd),
        `--allow-fs-write=${appDataDir}`,
        "--allow-addons",
        "--allow-child-process",
        "--allow-net",
        workerEntry,
      ],
      {
        cwd,
        env: {
          LANG: process.env.LANG ?? "en_US.UTF-8",
          LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: runtimeHome,
          TMPDIR: runtimeTmp,
          XDG_CONFIG_HOME: resolve(runtimeHome, ".config"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.consumeOutput(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-32_768);
    });
    child.once("error", (error) => this.handleExit(error));
    child.once("exit", (code, signal) => {
      this.handleExit(
        new Error(
          `Pi Worker exited (${signal ?? code ?? "unknown"})${
            this.stderr.trim() ? `: ${this.stderr.trim()}` : ""
          }`,
        ),
      );
    });

    try {
      await this.request(
        createDesktopCommand({
          type: "host.bootstrap",
          appDataDir,
        }),
      );
      await this.configure(this.launch.endpoints, this.launch.extensions);
      this.taskState = (await this.request(
        this.launch.task,
      )) as DesktopTaskState;
    } catch (error) {
      this.dispose("Pi Task Worker initialization failed");
      throw error;
    }
  }

  private consumeOutput(chunk: Buffer): void {
    try {
      this.outputBuffer += chunk.toString();
      if (Buffer.byteLength(this.outputBuffer) > MAX_WORKER_LINE_BYTES * 2) {
        throw new Error("Pi Worker emitted an oversized protocol line");
      }
      const lines = this.outputBuffer.split("\n");
      this.outputBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        if (Buffer.byteLength(line) > MAX_WORKER_LINE_BYTES) {
          throw new Error("Pi Worker message exceeds the 8 MiB limit");
        }
        const message = JSON.parse(line) as HostToDesktopMessage;
        if (message.type === "response" && message.correlationId) {
          const pending = this.pending.get(message.correlationId);
          if (!pending) continue;
          this.pending.delete(message.correlationId);
          clearTimeout(pending.timer);
          if (message.ok) {
            pending.resolve(message.result);
          } else {
            pending.reject(new Error(message.error.message));
          }
          continue;
        }
        if (message.type === "host.hello" || message.type === "host.status") {
          continue;
        }
        this.launch.onEvent(message);
      }
    } catch (error: unknown) {
      this.handleExit(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.child?.kill("SIGKILL");
    }
  }

  private handleExit(error: Error): void {
    if (this.disposed && this.expectedExit) return;
    this.disposed = true;
    this.child = undefined;
    this.rejectAll(error);
    this.launch.onExit(error);
  }

  private write(message: DesktopToHostMessage): void {
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded) > MAX_WORKER_LINE_BYTES) {
      throw new Error("Pi Worker command exceeds the 8 MiB limit");
    }
    this.child?.stdin.write(`${encoded}\n`);
  }

  private rejectAll(error: Error): void {
    for (const [messageId, pending] of this.pending) {
      this.pending.delete(messageId);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function gitProbePermissions(cwd: string): string[] {
  const permissions: string[] = [];
  let directory = cwd;
  while (true) {
    permissions.push(`--allow-fs-read=${join(directory, ".git")}`);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return permissions;
}
