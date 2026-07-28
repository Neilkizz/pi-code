import * as vscode from "vscode";
import type { ExtensionContext } from "../types/ExtensionContext";
import type { SessionManager } from "../session/SessionManager";
import * as T from "../rpc/types";

/**
 * PiTerminal — optional integration. Creates a VS Code terminal running the
 * `pi` interactive TUI for power users, and (when enabled) forwards bash tool
 * output from the active session into a dedicated terminal for live shell
 * observability. Off by default (pi.enableTerminalIntegration).
 */
export class PiTerminal implements vscode.Disposable {
  private terminal: vscode.Terminal | null = null;
  private eventSubs = new Map<string, vscode.Disposable>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private ctx: ExtensionContext,
    private sessions: SessionManager,
  ) {
    this.disposables.push(sessions.onDidChange(() => this.syncSubscriptions()));
    this.syncSubscriptions();
    // Close our terminal on terminal-close events so we don't reuse a dead one.
    this.disposables.push(
      vscode.window.onDidCloseTerminal((t) => {
        if (t === this.terminal) this.terminal = null;
      }),
    );
  }

  /** Open (or focus) the interactive `pi` TUI terminal. */
  show(): void {
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal({
        name: "Pi",
        cwd: this.ctx.config.cwd(),
      });
      this.terminal.sendText(`${this.ctx.config.executable}\n`);
    }
    this.terminal.show();
  }

  private syncSubscriptions(): void {
    if (!this.ctx.config.enableTerminalIntegration) return;
    const live = new Set(this.sessions.list().map((s) => s.id));
    for (const session of this.sessions.list()) {
      if (!this.eventSubs.has(session.id)) {
        const sub = session.onEvent((e) => this.onEvent(session.id, e));
        this.eventSubs.set(session.id, sub);
      }
    }
    for (const [id, sub] of this.eventSubs) {
      if (!live.has(id)) {
        sub.dispose();
        this.eventSubs.delete(id);
      }
    }
  }

  private onEvent(_sessionId: string, e: T.PiEvent): void {
    // Forward streaming bash tool output to the terminal for live observability.
    if (e.type === "tool_execution_update") {
      const update = e as T.ToolExecutionUpdateEvent;
      if (update.toolName !== "bash") return;
      const text = this.extractText(update.partialResult);
      if (text && this.terminal) {
        this.terminal.sendText(text, true);
      }
    }
    // Handle dedicated bash_execution_update events if Pi emits them.
    if (e.type === "bash_execution_update") {
      const bash = e as T.BashExecutionUpdateEvent;
      const text = typeof bash.output === "string"
        ? bash.output
        : this.extractText(bash);
      if (text && this.terminal) {
        this.terminal.sendText(text, true);
      }
    }
  }

  private extractText(partial: any): string | undefined {
    if (!partial) return undefined;
    if (typeof partial === "string") return partial;
    if (Array.isArray(partial?.content)) {
      return partial.content
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("\n");
    }
    return undefined;
  }

  dispose(): void {
    for (const sub of this.eventSubs.values()) sub.dispose();
    this.eventSubs.clear();
    this.terminal?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
