import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type {
  SessionEntry,
  SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import {
  DESKTOP_PROTOCOL_MIN_VERSION,
  DESKTOP_PROTOCOL_VERSION,
  createDesktopCommand,
  createHostMessage,
} from "@pi-desktop/protocol";
import type {
  DesktopToHostPayload,
  DesktopTaskState,
  DesktopToHostMessage,
  EndpointRuntimeConfig,
  ExtensionRuntimeConfig,
  HostToDesktopPayload,
  HostToDesktopMessage,
  PiSessionEvent,
  SessionTree,
  SessionTreeEntry,
  TaskIsolation,
  TaskPromptAttachment,
  TaskRuntimeProfile,
  TaskTranscriptMessage,
} from "@pi-desktop/protocol";
import { PermissionGate } from "./permission-gate.js";
import { BrokerClient } from "./broker-client.js";
import { createBrokerToolsExtension } from "./broker-tools.js";
import { createDesktopResourceLoader } from "./resource-loader.js";
import type { DesktopSessionRuntime } from "./session-runtime.js";
import {
  TaskRunController,
  type PromptImage,
} from "./task-run-controller.js";
import {
  createManagedExtensionTools,
  startManagedExtensionWorkers,
} from "./managed-extension-worker.js";
import { TaskWorkerProxy } from "./task-worker-proxy.js";

type Send = (message: HostToDesktopMessage) => void;
type TaskCreateCommand = Extract<
  DesktopToHostMessage,
  { type: "task.create" }
>;
type TaskCloseCommand = Extract<
  DesktopToHostMessage,
  { type: "task.close" }
>;

const WORKER_RECOVERY_DELAYS_MS = [500, 2_000, 8_000] as const;

interface DesktopHostOptions {
  sessionWorker?: boolean;
}

export class DesktopHost {
  private readonly sessions = new Map<string, DesktopSessionRuntime>();
  private readonly send: Send;
  private readonly workerId = randomUUID();
  private readonly taskSequences = new Map<string, number>();
  private readonly taskWorkers = new Map<string, TaskWorkerProxy>();
  private readonly taskDefinitions = new Map<string, TaskCreateCommand>();
  private readonly recoveryAttempts = new Map<string, number>();
  private readonly recoveryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly sessionWorker: boolean;
  private shuttingDown = false;
  private appDataDir?: string;
  private modelRuntime?: ModelRuntime;
  private readonly endpointProviderIds = new Set<string>();
  private endpointConfigs: EndpointRuntimeConfig[] = [];
  private extensionConfigs: ExtensionRuntimeConfig[] = [];

  constructor(send: Send, options: DesktopHostOptions = {}) {
    this.send = send;
    this.sessionWorker = options.sessionWorker ?? false;
  }

  async handle(message: DesktopToHostMessage): Promise<void> {
    if (message.type === "broker.response") {
      if (this.sessionWorker) {
        this.respondToBroker(
          message.taskId,
          message.requestId,
          message.ok,
          message.result,
          message.error,
        );
      } else {
        this.requireTaskWorker(message.taskId).send(message);
      }
      return;
    }
    const taskId = taskIdFromCommand(message);
    try {
      const result = await this.dispatch(message);
      this.emit(
        { type: "response", ok: true, result },
        { correlationId: message.messageId, taskId },
      );
    } catch (error: unknown) {
      this.emit(
        {
          type: "response",
          ok: false,
          error: {
            code: "HOST_COMMAND_FAILED",
            message: formatError(error),
          },
        },
        { correlationId: message.messageId, taskId },
      );
    }
  }

  async dispose(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.recoveryTimers.values()) {
      clearTimeout(timer);
    }
    this.recoveryTimers.clear();
    this.taskDefinitions.clear();
    for (const worker of this.taskWorkers.values()) {
      worker.dispose("Pi Host coordinator stopped");
    }
    this.taskWorkers.clear();
    for (const runtime of this.sessions.values()) {
      runtime.permissionGate.cancelAll("Pi Host stopped");
      runtime.brokerClient.cancelAll("Pi Host stopped");
      for (const worker of runtime.extensionWorkers) {
        worker.dispose("Pi Host stopped");
      }
      runtime.unsubscribe();
      await runtime.session.dispose();
    }
    this.sessions.clear();
    this.taskSequences.clear();
  }

  private async dispatch(message: DesktopToHostMessage): Promise<unknown> {
    switch (message.type) {
      case "host.bootstrap":
        return this.bootstrap(message.appDataDir);
      case "host.configureEndpoints":
        return this.configureEndpoints(message.endpoints);
      case "host.configureExtensions":
        return this.configureExtensions(message.extensions);
      case "task.create":
        return this.sessionWorker
          ? this.createTask(
              message.taskId,
              message.cwd,
              message.isolation,
              message.profile,
              message.projectInstructions,
              message.resume,
            )
          : this.createTaskWorker(message);
      case "task.prompt":
        return this.sessionWorker
          ? this.startPromptTask(
              message.taskId,
              message.prompt,
              message.attachments,
            )
          : this.requireTaskWorker(message.taskId).request(message);
      case "task.abort":
        return this.sessionWorker
          ? this.abortTask(message.taskId)
          : this.requireTaskWorker(message.taskId).request(message);
      case "task.getTree":
        return this.sessionWorker
          ? this.emitSessionTree(message.taskId)
          : this.requireTaskWorker(message.taskId).request(message);
      case "task.close":
        return this.sessionWorker
          ? this.closeTask(message.taskId)
          : this.closeTaskWorker(message);
      case "task.permission.respond":
        return this.sessionWorker
          ? this.respondToPermission(
              message.taskId,
              message.requestId,
              message.approved,
            )
          : this.requireTaskWorker(message.taskId).request(message);
      case "broker.response":
        return undefined;
    }
  }

  private async bootstrap(appDataDir: string): Promise<{ version: string }> {
    this.appDataDir = appDataDir;
    this.emit({
      type: "host.hello",
      hello: {
        minVersion: DESKTOP_PROTOCOL_MIN_VERSION,
        maxVersion: DESKTOP_PROTOCOL_VERSION,
        selectedVersion: DESKTOP_PROTOCOL_VERSION,
        hostVersion: VERSION,
        features: [
          "endpoint-runtime",
          "resource-profiles",
          "session-resume",
          "task-events",
          "permission-modes-v2",
          "capability-broker-v1",
          "managed-extension-worker-v1",
          "per-task-worker-v1",
          "snapshot-delta",
          "sessions-tree",
        ],
      },
    });
    this.emit({
      type: "host.status",
      state: {
        status: "starting",
        runtime: this.sessionWorker
          ? "pi-agent-task-worker"
          : "pi-agent-coordinator",
        version: VERSION,
      },
    });

    if (this.sessionWorker) {
      this.modelRuntime = await ModelRuntime.create({
        authPath: join(appDataDir, "auth.json"),
        modelsPath: join(appDataDir, "models.json"),
      });
    }

    this.emit({
      type: "host.status",
      state: {
        status: "ready",
        runtime: this.sessionWorker
          ? "pi-agent-task-worker"
          : "pi-agent-coordinator",
        version: VERSION,
      },
    });
    return { version: VERSION };
  }

  private async createTaskWorker(
    message: TaskCreateCommand,
  ): Promise<DesktopTaskState> {
    if (!this.appDataDir) {
      throw new Error("Host must be bootstrapped before creating a task");
    }
    const existing = this.taskWorkers.get(message.taskId);
    if (existing) {
      return (await existing.request(message)) as DesktopTaskState;
    }

    const taskCommand = {
      ...message,
      profile: normalizeProfile(message.profile),
    };
    this.cancelRecovery(message.taskId);
    this.taskDefinitions.set(message.taskId, taskCommand);
    this.recoveryAttempts.delete(message.taskId);
    const worker = await this.launchTaskWorker(taskCommand);
    this.taskWorkers.set(message.taskId, worker);
    if (!worker.taskState) {
      worker.dispose("Pi Task Worker returned no initial state");
      this.taskWorkers.delete(message.taskId);
      throw new Error("Pi Task Worker returned no initial state");
    }
    return worker.taskState;
  }

  private async closeTaskWorker(
    message: TaskCloseCommand,
  ): Promise<unknown> {
    this.taskDefinitions.delete(message.taskId);
    this.recoveryAttempts.delete(message.taskId);
    this.cancelRecovery(message.taskId);
    const worker = this.taskWorkers.get(message.taskId);
    if (!worker) {
      return { closed: true };
    }
    const result = await worker.request(message);
    worker.dispose("Task session closed");
    this.taskWorkers.delete(message.taskId);
    return result;
  }

  private async launchTaskWorker(
    taskCommand: TaskCreateCommand,
  ): Promise<TaskWorkerProxy> {
    if (!this.appDataDir) {
      throw new Error("Host must be bootstrapped before creating a task");
    }
    let workerReference: TaskWorkerProxy | undefined;
    let initialized = false;
    const worker = await TaskWorkerProxy.start({
      appDataDir: this.appDataDir,
      task: taskCommand,
      endpoints: this.endpointConfigs,
      extensions: this.extensionConfigs,
      onEvent: (event) => this.send(event),
      onExit: (error) => {
        if (initialized && workerReference) {
          this.handleTaskWorkerExit(taskCommand, workerReference, error);
        }
      },
    });
    workerReference = worker;
    initialized = true;
    return worker;
  }

  private handleTaskWorkerExit(
    taskCommand: TaskCreateCommand,
    worker: TaskWorkerProxy,
    error: Error,
  ): void {
    if (this.taskWorkers.get(taskCommand.taskId) !== worker) {
      return;
    }
    this.taskWorkers.delete(taskCommand.taskId);
    this.emitWorkerFailure(taskCommand, error.message);
    this.scheduleTaskRecovery(taskCommand, error);
  }

  private scheduleTaskRecovery(
    taskCommand: TaskCreateCommand,
    cause: Error,
  ): void {
    if (
      this.shuttingDown ||
      !this.taskDefinitions.has(taskCommand.taskId) ||
      this.recoveryTimers.has(taskCommand.taskId)
    ) {
      return;
    }
    const attempt = (this.recoveryAttempts.get(taskCommand.taskId) ?? 0) + 1;
    this.recoveryAttempts.set(taskCommand.taskId, attempt);
    const delay = WORKER_RECOVERY_DELAYS_MS[attempt - 1];
    if (delay === undefined) {
      this.emitWorkerFailure(
        taskCommand,
        `Safe Mode: automatic recovery stopped after ${
          WORKER_RECOVERY_DELAYS_MS.length
        } attempts. Last error: ${cause.message}`,
      );
      return;
    }
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(taskCommand.taskId);
      const definition = this.taskDefinitions.get(taskCommand.taskId);
      if (!definition || this.shuttingDown) return;
      const recoveryCommand = createRecoveryCommand(definition);
      void this.launchTaskWorker(recoveryCommand)
        .then((worker) => {
          if (
            this.shuttingDown ||
            !this.taskDefinitions.has(taskCommand.taskId)
          ) {
            worker.dispose("Recovered task was closed");
            return;
          }
          this.taskWorkers.set(taskCommand.taskId, worker);
        })
        .catch((error: unknown) => {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          this.emitWorkerFailure(recoveryCommand, failure.message);
          this.scheduleTaskRecovery(recoveryCommand, failure);
        });
    }, delay);
    this.recoveryTimers.set(taskCommand.taskId, timer);
  }

  private emitWorkerFailure(
    taskCommand: TaskCreateCommand,
    error: string,
  ): void {
    this.emit(
      {
        type: "task.status",
        task: {
          id: taskCommand.taskId,
          cwd: taskCommand.cwd,
          status: "failed",
          profile: taskCommand.profile,
          error,
        },
      },
      { taskId: taskCommand.taskId },
    );
  }

  private cancelRecovery(taskId: string): void {
    const timer = this.recoveryTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.recoveryTimers.delete(taskId);
    }
  }

  private requireTaskWorker(taskId: string): TaskWorkerProxy {
    const worker = this.taskWorkers.get(taskId);
    if (!worker) {
      throw new Error(`Unknown or stopped Pi Task Worker: ${taskId}`);
    }
    return worker;
  }

  private async createTask(
    taskId: string,
    cwd: string,
    isolation: TaskIsolation,
    profile: TaskRuntimeProfile,
    projectInstructions: string | undefined,
    resume: boolean,
  ): Promise<DesktopTaskState> {
    const existing = this.sessions.get(taskId);
    if (existing) {
      return this.emitTaskState(
        taskId,
        existing.cwd,
        existing.runController.isActive ? "running" : "idle",
        existing.profile,
      );
    }
    if (!this.appDataDir || !this.modelRuntime) {
      throw new Error("Host must be bootstrapped before creating a task");
    }

    const normalizedProfile = normalizeProfile(profile);
    const model =
      normalizedProfile.providerId && normalizedProfile.modelId
        ? this.modelRuntime.getModel(
            normalizedProfile.providerId,
            normalizedProfile.modelId,
          )
        : undefined;
    if (
      normalizedProfile.providerId &&
      normalizedProfile.modelId &&
      !model
    ) {
      throw new Error(
        `Unknown model: ${normalizedProfile.providerId}/${normalizedProfile.modelId}`,
      );
    }

    const agentDir = join(this.appDataDir, "agent");
    const sessionDir = join(this.appDataDir, "sessions", taskId);
    const settingsManager = SettingsManager.inMemory(
      { sessionDir },
      { projectTrusted: false },
    );
    const permissionGate = new PermissionGate(
      taskId,
      normalizedProfile.permissionMode,
      isolation,
      (request) => {
        this.emit({ type: "task.permission.request", request }, { taskId });
      },
      (waiting) => {
        const runtime = this.sessions.get(taskId);
        if (runtime?.runController.isActive) {
          this.emitTaskState(
            taskId,
            cwd,
            waiting ? "waiting" : "running",
            normalizedProfile,
          );
        }
      },
    );
    const brokerClient = new BrokerClient(
      taskId,
      cwd,
      isolation,
      (request) => {
        this.emit({ type: "task.broker.request", request }, { taskId });
      },
    );
    const extensionWarnings: string[] = [];
    const extensionWorkers = await startManagedExtensionWorkers(
      this.extensionConfigs,
      cwd,
      (failure) => {
        extensionWarnings.push(
          `Extension '${failure.extensionName}' was disabled for this task: ${failure.message}`,
        );
      },
    );
    let resourceLoader;
    try {
      resourceLoader = await createDesktopResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        extensionFactories: [
          permissionGate.extension,
          createManagedExtensionTools(
            extensionWorkers,
            permissionGate,
            brokerClient,
          ),
          createBrokerToolsExtension({
            cwd,
            gate: permissionGate,
            client: brokerClient,
          }),
        ],
        projectInstructions,
      });
    } catch (error) {
      for (const worker of extensionWorkers) {
        worker.dispose("Task creation failed");
      }
      throw error;
    }
    const sessionManager = resume
      ? SessionManager.continueRecent(cwd, sessionDir)
      : SessionManager.create(cwd, sessionDir);
    if (resume) {
      this.emit(
        {
          type: "task.history",
          taskId,
          messages: toTranscriptMessages(
            sessionManager.buildSessionContext().messages,
          ),
        },
        { taskId },
      );
    }
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
    try {
      ({ session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime: this.modelRuntime,
        settingsManager,
        sessionManager,
        resourceLoader,
        model,
        sessionStartEvent: { type: "session_start", reason: "startup" },
      }));
    } catch (error) {
      for (const worker of extensionWorkers) {
        worker.dispose("Task creation failed");
      }
      throw error;
    }

    const runController = new TaskRunController(
      session,
      (status, error) => {
        this.emitTaskState(taskId, cwd, status, normalizedProfile, error);
      },
      () => {
        permissionGate.cancelAll("Task stopped by user");
        brokerClient.cancelAll("Task stopped by user");
      },
    );
    const runtime: DesktopSessionRuntime = {
      taskId,
      cwd,
      profile: normalizedProfile,
      session,
      sessionManager,
      permissionGate,
      brokerClient,
      extensionWorkers,
      warnings: extensionWarnings,
      runController,
      unsubscribe: () => undefined,
    };
    runtime.unsubscribe = session.subscribe((event) => {
      this.emit(
        {
          type: "task.event",
          taskId,
          event: toSerializableEvent(event),
        },
        { taskId },
      );
    });
    this.sessions.set(taskId, runtime);

    return this.emitTaskState(taskId, cwd, "idle", normalizedProfile);
  }

  private emitSessionTree(taskId: string): void {
    const runtime = this.sessions.get(taskId);
    if (!runtime) {
      return;
    }
    const tree = mapSessionTree(runtime.sessionManager, taskId);
    this.emit({ type: "task.tree", taskId, tree }, { taskId });
  }

  private async configureEndpoints(
    endpoints: EndpointRuntimeConfig[],
  ): Promise<{ configured: number }> {
    this.endpointConfigs = endpoints.map((endpoint) => ({
      ...endpoint,
      models: [...endpoint.models],
    }));
    if (!this.sessionWorker) {
      await Promise.all(
        [...this.taskWorkers.values()].map((worker) =>
          worker.configure(this.endpointConfigs, this.extensionConfigs),
        ),
      );
      return {
        configured: this.endpointConfigs.filter(
          (endpoint) => endpoint.models.length > 0,
        ).length,
      };
    }
    if (!this.modelRuntime) {
      throw new Error("Host must be bootstrapped before configuring endpoints");
    }

    const nextIds = new Set(endpoints.map((endpoint) => endpoint.id));
    for (const providerId of this.endpointProviderIds) {
      if (!nextIds.has(providerId)) {
        await this.modelRuntime.removeRuntimeApiKey(providerId);
        this.modelRuntime.unregisterProvider(providerId);
        this.endpointProviderIds.delete(providerId);
      }
    }

    let configured = 0;
    for (const endpoint of endpoints) {
      if (endpoint.models.length === 0) {
        continue;
      }

      const api =
        endpoint.kind === "anthropic-compatible"
          ? "anthropic-messages"
          : "openai-completions";
      await this.modelRuntime.removeRuntimeApiKey(endpoint.id);
      this.modelRuntime.registerProvider(endpoint.id, {
        name: endpoint.name,
        baseUrl: endpoint.baseUrl,
        api,
        apiKey:
          endpoint.apiKey ?? (endpoint.kind === "ollama" ? "ollama" : undefined),
        models: endpoint.models.map((model) => ({
          id: model,
          name: model,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
          compat:
            endpoint.kind === "ollama"
              ? {
                  supportsDeveloperRole: false,
                  supportsReasoningEffort: false,
                }
              : undefined,
        })),
      });
      if (endpoint.apiKey) {
        await this.modelRuntime.setRuntimeApiKey(endpoint.id, endpoint.apiKey);
      }
      this.endpointProviderIds.add(endpoint.id);
      configured += 1;
    }

    return { configured };
  }

  private async configureExtensions(
    extensions: ExtensionRuntimeConfig[],
  ): Promise<{ configured: number }> {
    this.extensionConfigs = deduplicateExtensions(extensions);
    if (!this.sessionWorker) {
      await Promise.all(
        [...this.taskWorkers.values()].map((worker) =>
          worker.configure(this.endpointConfigs, this.extensionConfigs),
        ),
      );
    }
    return { configured: this.extensionConfigs.length };
  }

  private async startPromptTask(
    taskId: string,
    prompt: string,
    attachments: TaskPromptAttachment[],
  ): Promise<{ accepted: true }> {
    const runtime = this.requireTask(taskId);
    const prepared = await this.preparePromptAttachments(
      taskId,
      prompt,
      attachments,
    );
    const supportsImages =
      runtime.session.model?.input.includes("image") ?? false;
    const text = !supportsImages && prepared.images.length > 0
      ? `${prepared.text}\n\n[Pi Desktop: The selected model does not advertise image input, so image bytes were not sent. Choose a vision-capable model to analyze them.]`
      : prepared.text;
    return runtime.runController.start(
      text,
      supportsImages ? prepared.images : [],
    );
  }

  private async preparePromptAttachments(
    taskId: string,
    prompt: string,
    attachments: TaskPromptAttachment[],
  ): Promise<{ text: string; images: PromptImage[] }> {
    if (attachments.length === 0) {
      return { text: prompt, images: [] };
    }
    if (!this.appDataDir) {
      throw new Error("Host must be bootstrapped before reading attachments");
    }
    if (attachments.length > 20) {
      throw new Error("A prompt cannot contain more than 20 attachments");
    }

    const attachmentRoot = await realpath(
      join(this.appDataDir, "attachments", taskId),
    );
    const rootPrefix = `${attachmentRoot}${sep}`;
    const images: PromptImage[] = [];
    const context: string[] = [
      "\n\n<pi-desktop-attachments>",
      "The following content was imported by Pi Desktop and verified immediately before this turn.",
    ];
    let totalBytes = 0;
    let inlineTextBytes = 0;

    for (const attachment of attachments) {
      const canonical = await realpath(resolve(attachment.path));
      if (!canonical.startsWith(rootPrefix)) {
        throw new Error(
          `Attachment '${attachment.name}' is outside this task's private storage`,
        );
      }
      const metadata = await stat(canonical);
      if (!metadata.isFile() || metadata.size !== attachment.size) {
        throw new Error(
          `Attachment '${attachment.name}' changed after it was imported`,
        );
      }
      totalBytes += metadata.size;
      if (metadata.size > 25 * 1024 * 1024 || totalBytes > 100 * 1024 * 1024) {
        throw new Error("Attachment size limits were exceeded");
      }
      const bytes = await readFile(canonical);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== attachment.sha256.toLocaleLowerCase()) {
        throw new Error(
          `Attachment '${attachment.name}' failed integrity verification`,
        );
      }

      const label = JSON.stringify(attachment.name);
      if (
        attachment.kind === "image" &&
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          attachment.mimeType,
        )
      ) {
        if (metadata.size > 10 * 1024 * 1024) {
          throw new Error(`Image '${attachment.name}' exceeds the 10 MiB model limit`);
        }
        images.push({
          type: "image",
          data: bytes.toString("base64"),
          mimeType: attachment.mimeType,
        });
        context.push(
          `- image ${label} (${attachment.mimeType}, ${metadata.size} bytes, sha256 ${digest})`,
        );
        continue;
      }

      if (isTextAttachment(attachment.mimeType) && inlineTextBytes < 1024 * 1024) {
        const remaining = 1024 * 1024 - inlineTextBytes;
        const bounded = bytes.subarray(0, Math.min(bytes.length, 512 * 1024, remaining));
        inlineTextBytes += bounded.length;
        context.push(
          `<attachment name=${label} mime=${JSON.stringify(attachment.mimeType)} sha256=${JSON.stringify(digest)} truncated=${bounded.length < bytes.length}>`,
          bounded.toString("utf8"),
          "</attachment>",
        );
      } else {
        context.push(
          `- file ${label} (${attachment.mimeType}, ${metadata.size} bytes, sha256 ${digest}); binary/PDF content is retained locally but not decoded into this text turn`,
        );
      }
    }
    context.push("</pi-desktop-attachments>");
    return { text: `${prompt}${context.join("\n")}`, images };
  }

  private async abortTask(taskId: string): Promise<void> {
    const runtime = this.requireTask(taskId);
    await runtime.runController.abort();
  }

  private async closeTask(taskId: string): Promise<{ closed: true }> {
    const runtime = this.requireTask(taskId);
    await runtime.runController.abort();
    runtime.permissionGate.cancelAll("Task session closed");
    runtime.brokerClient.cancelAll("Task session closed");
    for (const worker of runtime.extensionWorkers) {
      worker.dispose("Task session closed");
    }
    runtime.unsubscribe();
    await runtime.session.dispose();
    this.sessions.delete(taskId);
    return { closed: true };
  }

  private respondToPermission(
    taskId: string,
    requestId: string,
    approved: boolean,
  ): { resolved: true } {
    const runtime = this.requireTask(taskId);
    runtime.permissionGate.respond(requestId, approved);
    return { resolved: true };
  }

  private respondToBroker(
    taskId: string,
    requestId: string,
    ok: boolean,
    result?: unknown,
    error?: { code: string; message: string },
  ): void {
    const runtime = this.requireTask(taskId);
    runtime.brokerClient.respond({ requestId, ok, result, error });
  }

  private requireTask(taskId: string): DesktopSessionRuntime {
    const runtime = this.sessions.get(taskId);
    if (!runtime) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return runtime;
  }

  private emitTaskState(
    id: string,
    cwd: string,
    status: DesktopTaskState["status"],
    profile: TaskRuntimeProfile,
    error?: string,
  ): DesktopTaskState {
    const warnings = this.sessions.get(id)?.warnings ?? [];
    const task = {
      id,
      cwd,
      status,
      profile,
      error,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
    this.emit({ type: "task.status", task }, { taskId: id });
    return task;
  }

  private emit(
    payload: HostToDesktopPayload,
    options: { correlationId?: string; taskId?: string } = {},
  ): void {
    const seq = options.taskId
      ? (this.taskSequences.get(options.taskId) ?? 0) + 1
      : undefined;
    if (options.taskId && seq !== undefined) {
      this.taskSequences.set(options.taskId, seq);
    }
    this.send(
      createHostMessage(payload, {
        correlationId: options.correlationId,
        taskId: options.taskId,
        workerId: this.workerId,
        seq,
      }),
    );
  }
}

function normalizeProfile(profile: TaskRuntimeProfile): TaskRuntimeProfile {
  if (
    profile.permissionMode !== "ask" &&
    profile.permissionMode !== "acceptEdits" &&
    profile.permissionMode !== "plan" &&
    profile.permissionMode !== "auto"
  ) {
    throw new Error(`Unsupported permission mode: ${String(profile.permissionMode)}`);
  }
  if (profile.permissionMode === "auto") {
    throw new Error(
      "Auto mode is disabled until Pi Desktop has an active strong isolation backend",
    );
  }

  const providerId = profile.providerId?.trim() || undefined;
  const modelId = profile.modelId?.trim() || undefined;
  if (Boolean(providerId) !== Boolean(modelId)) {
    throw new Error("Provider and model must be selected together");
  }
  return {
    providerId,
    modelId,
    permissionMode: profile.permissionMode,
  };
}

function toSerializableEvent(event: unknown): PiSessionEvent {
  try {
    return JSON.parse(JSON.stringify(event)) as PiSessionEvent;
  } catch {
    return { type: "unserializable_event" };
  }
}

export function toTranscriptMessages(messages: unknown[]): TaskTranscriptMessage[] {
  const transcript: TaskTranscriptMessage[] = [];
  let remainingCharacters = 1_000_000;
  for (const [index, value] of messages.entries()) {
    if (!isRecord(value)) {
      continue;
    }
    const role =
      value.role === "user"
        ? "user"
        : value.role === "assistant"
          ? "assistant"
          : value.role === "compactionSummary"
            ? "compactionSummary"
            : value.role === "branchSummary"
              ? "branchSummary"
              : undefined;
    if (!role) {
      continue;
    }
    // Compaction/branch summary messages carry their text in `summary` rather
    // than `content`.
    const rawText =
      role === "compactionSummary" || role === "branchSummary"
        ? typeof value.summary === "string"
          ? value.summary
          : ""
        : messageText(value.content);
    const text = stripAttachmentContext(rawText).slice(
      0,
      Math.min(50_000, remainingCharacters),
    );
    if (!text) {
      continue;
    }
    const label =
      typeof value.label === "string" && value.label.length > 0
        ? value.label
        : undefined;
    transcript.push({
      id: `history-${index}`,
      role,
      text,
      createdAt: timestampMillis(value.timestamp),
      ...(label ? { label } : {}),
    });
    remainingCharacters -= text.length;
    if (remainingCharacters <= 0 || transcript.length >= 200) {
      break;
    }
  }
  return transcript;
}

export function mapSessionTree(
  sessionManager: SessionManager,
  taskId: string,
): SessionTree {
  const nodes = sessionManager.getTree();
  const leafId = sessionManager.getLeafId();
  const parentById = new Map<string, string | null>();
  const collectParents = (node: SessionTreeNode): void => {
    parentById.set(node.entry.id, node.entry.parentId);
    for (const child of node.children) collectParents(child);
  };
  for (const node of nodes) collectParents(node);

  const currentIds = new Set<string>();
  let cursor: string | null = leafId;
  while (cursor) {
    currentIds.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }

  const entries: SessionTreeEntry[] = [];
  const flatten = (node: SessionTreeNode): void => {
    const entry = node.entry;
    const text = sessionEntryText(entry);
    entries.push({
      entryId: entry.id,
      parentEntryId: entry.parentId,
      type: entry.type,
      ...(node.label ? { label: node.label } : {}),
      ...(text ? { text } : {}),
      ...(typeof entry.timestamp === "string" && entry.timestamp.length > 0
        ? { timestamp: entry.timestamp }
        : {}),
      current: currentIds.has(entry.id),
    });
    for (const child of node.children) flatten(child);
  };
  for (const node of nodes) flatten(node);

  return { taskId, leafId: leafId ?? "", entries };
}

function sessionEntryText(entry: SessionEntry): string {
  if (entry.type === "message") {
    const content = (entry.message as { content?: unknown }).content;
    return firstLine(messageText(content));
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return firstLine(typeof entry.summary === "string" ? entry.summary : "");
  }
  return "";
}

function firstLine(value: string): string {
  const line = value.split("\n")[0]?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      if (part.type === "text" && typeof part.text === "string") {
        return [part.text];
      }
      return [];
    })
    .join("\n");
}

function stripAttachmentContext(value: string): string {
  const marker = "\n\n<pi-desktop-attachments>";
  const index = value.indexOf(marker);
  return index === -1 ? value : value.slice(0, index);
}

function isTextAttachment(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/yaml" ||
    mimeType === "application/xml"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const details = error as Error & {
    code?: unknown;
    permission?: unknown;
    resource?: unknown;
  };
  const context = [details.code, details.permission, details.resource]
    .filter((value): value is string => typeof value === "string")
    .join(": ");
  return context ? `${error.message} (${context})` : error.message;
}

function deduplicateExtensions(
  configs: ExtensionRuntimeConfig[],
): ExtensionRuntimeConfig[] {
  const byId = new Map<string, ExtensionRuntimeConfig>();
  const paths = new Set<string>();
  for (const config of configs) {
    if (byId.has(config.id)) {
      throw new Error(`Duplicate Managed Extension id: ${config.id}`);
    }
    if (paths.has(config.installPath)) {
      throw new Error(
        `Multiple Managed Extensions resolve to the same snapshot: ${config.installPath}`,
      );
    }
    byId.set(config.id, { ...config });
    paths.add(config.installPath);
  }
  return [...byId.values()];
}

function createRecoveryCommand(
  definition: TaskCreateCommand,
): TaskCreateCommand {
  return createDesktopCommand({
    type: "task.create",
    taskId: definition.taskId,
    cwd: definition.cwd,
    isolation: definition.isolation,
    profile: definition.profile,
    projectInstructions: definition.projectInstructions,
    resume: true,
  });
}

function taskIdFromCommand(
  message: DesktopToHostMessage,
): string | undefined {
  const payload = message as DesktopToHostPayload;
  return "taskId" in payload ? payload.taskId : undefined;
}
