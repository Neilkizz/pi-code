import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type {
  TaskBrokerRequest,
  TaskIsolation,
} from "@pi-desktop/protocol";

interface ToolContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  approvalId?: string;
}

interface PendingBrokerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export interface BrokerResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export class BrokerClient {
  private readonly context = new AsyncLocalStorage<ToolContext>();
  private readonly pending = new Map<string, PendingBrokerRequest>();

  constructor(
    readonly taskId: string,
    readonly cwd: string,
    readonly isolation: TaskIsolation,
    private readonly emitRequest: (request: TaskBrokerRequest) => void,
  ) {}

  withToolContext<T>(
    context: ToolContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.context.run(context, operation);
  }

  request<T>(
    operation: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const context = this.context.getStore();
    if (!context) {
      return Promise.reject(
        new Error("Broker operation was attempted outside an authorized tool call"),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("Broker operation cancelled"));
    }
    const id = randomUUID();
    const request: TaskBrokerRequest = {
      id,
      taskId: this.taskId,
      toolName: context.toolName,
      toolInput: context.toolInput,
      approvalId: context.approvalId,
      operation,
      arguments: args,
    };
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.cleanup();
          pending.reject(new Error("Broker operation cancelled"));
        }
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup,
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.emitRequest(request);
    });
  }

  respond(response: BrokerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    pending.cleanup();
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }
    pending.reject(
      new Error(
        response.error?.message ??
          "Capability Broker rejected the operation without a reason",
      ),
    );
  }

  cancelAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.cleanup();
      pending.reject(new Error(reason));
    }
  }
}
