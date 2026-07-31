import { randomUUID } from "node:crypto";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type {
  TaskIsolation,
  TaskPermissionMode,
  TaskPermissionRequest,
} from "@pi-desktop/protocol";

interface PendingApproval {
  request: TaskPermissionRequest;
  resolve: (approved: boolean) => void;
  cleanup: () => void;
  denialReason?: string;
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILE_EDIT_TOOLS = new Set(["edit", "write", "apply_patch"]);
const BROKERED_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  ...FILE_EDIT_TOOLS,
  "bash",
]);

type GateDecision = "allow" | "ask" | "deny";

export class PermissionGate {
  readonly extension: InlineExtension;

  private readonly pending = new Map<string, PendingApproval>();
  private readonly managedTools = new Set<string>();

  constructor(
    private readonly taskId: string,
    private readonly mode: TaskPermissionMode,
    private readonly isolation: TaskIsolation,
    private readonly onRequest: (request: TaskPermissionRequest) => void,
    private readonly onWaitingChange: (waiting: boolean) => void,
  ) {
    this.extension = {
      name: "desktop-permission-gate",
      hidden: true,
      factory: (pi) => {
        pi.on("tool_call", async (event) => {
          if (
            BROKERED_TOOLS.has(event.toolName) ||
            this.managedTools.has(event.toolName)
          ) {
            return undefined;
          }
          return {
            block: true,
            reason:
              "This Extension tool is not managed by the desktop Capability Broker and is disabled",
          };
        });
      },
    };
  }

  registerManagedTool(toolName: string): void {
    if (!toolName.trim()) {
      throw new Error("Managed Extension tool name must be non-empty");
    }
    this.managedTools.add(toolName);
  }

  async authorize(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const decision = this.decide(toolName);
    if (decision === "allow") {
      return undefined;
    }
    if (decision === "deny") {
      throw new Error(
        this.mode === "auto"
          ? "Auto mode is unavailable until a strong isolation backend is active"
          : "This permission mode does not allow the requested tool",
      );
    }
    const request = await this.requestApproval(
      toolName,
      serializableInput(input),
      signal,
    );
    if (!request.approved) {
      throw new Error(request.reason);
    }
    return request.id;
  }

  respond(requestId: string, approved: boolean): void {
    const approval = this.pending.get(requestId);
    if (!approval) {
      throw new Error(`Unknown or resolved permission request: ${requestId}`);
    }
    this.settle(approval, approved);
  }

  cancelAll(reason: string): void {
    for (const approval of [...this.pending.values()]) {
      approval.denialReason = reason;
      this.settle(approval, false);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private decide(toolName: string): GateDecision {
    if (READ_ONLY_TOOLS.has(toolName)) {
      return "allow";
    }
    if (this.isolation === "readOnly") {
      return "deny";
    }
    if (this.mode === "plan" || this.mode === "auto") {
      return "deny";
    }
    if (
      this.mode === "acceptEdits" &&
      this.isolation === "worktree" &&
      FILE_EDIT_TOOLS.has(toolName)
    ) {
      return "allow";
    }
    return "ask";
  }

  private requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ id: string; approved: boolean; reason: string }> {
    if (signal?.aborted) {
      return Promise.resolve({
        id: "",
        approved: false,
        reason: "Tool execution cancelled",
      });
    }

    const request: TaskPermissionRequest = {
      id: randomUUID(),
      taskId: this.taskId,
      toolName,
      input,
    };

    return new Promise((resolve) => {
      const abort = () => {
        const approval = this.pending.get(request.id);
        if (approval) {
          approval.denialReason = "Tool execution cancelled";
          this.settle(approval, false);
        }
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const approval: PendingApproval = {
        request,
        resolve: (approved) =>
          resolve({
            id: request.id,
            approved,
            reason: approved
              ? "Approved"
              : approval.denialReason ?? "Tool execution denied by user",
          }),
        cleanup,
      };
      this.pending.set(request.id, approval);
      signal?.addEventListener("abort", abort, { once: true });
      this.onWaitingChange(true);
      this.onRequest(request);
    });
  }

  private settle(
    approval: PendingApproval,
    approved: boolean,
  ): void {
    if (!this.pending.delete(approval.request.id)) {
      return;
    }
    approval.cleanup();
    approval.resolve(approved);
    if (this.pending.size === 0) {
      this.onWaitingChange(false);
    }
  }
}

function serializableInput(input: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return { preview: String(input) };
  }
}
