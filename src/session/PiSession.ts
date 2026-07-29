import * as vscode from 'vscode';
import { PiRpcClient, type PiRpcClientOptions } from '../rpc/PiRpcClient';
import type { ExtensionContext } from '../types/ExtensionContext';
import type * as T from '../rpc/types';

/**
 * PiSession — owns one PiRpcClient (one subprocess) and the UI-facing state
 * derived from it (model, thinking level, streaming flag, session name).
 *
 * It does NOT own the webview — the ChatProvider renders whichever session is
 * "active". The SessionManager owns the set; PiSession exposes the API the
 * webview needs.
 */
export class PiSession implements vscode.Disposable {
  readonly id: string;
  readonly client: PiRpcClient;
  private eventSub: vscode.Disposable | null = null;
  private _state: T.PiState | null = null;

  /** Fired whenever UI-visible state changes. */
  private stateEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.stateEmitter.event;

  /** Fired for every raw Pi event, so the ChatProvider can forward to the UI. */
  private eventEmitter = new vscode.EventEmitter<T.PiEvent>();
  readonly onEvent = this.eventEmitter.event;

  private disposed = false;

  constructor(ctx: ExtensionContext, id: string, clientOptions?: Partial<PiRpcClientOptions>) {
    this.id = id;
    const { config } = ctx;
    this.client = new PiRpcClient({
      executable: config.executable,
      extraArgs: [...config.extraArgs(), '--session-id', id],
      cwd: config.cwd(),
      autoReconnect: config.autoReconnect,
      log: (level, msg) => ctx.log(level, `[session ${id}] ${msg}`),
      ...clientOptions,
    });
    this.client.start();
    this.eventSub = this.client.onEvent((e) => {
      this.eventEmitter.fire(e);
      // Re-derive lightweight state from events so the UI stays in sync.
      this.maintainStateFromEvent(e);
    });
  }

  private maintainStateFromEvent(e: T.PiEvent): void {
    let changed = false;
    if (e.type === 'agent_start') {
      if (!this._state?.isStreaming) {
        this._state = {
          ...(this._state ?? ({} as T.PiState)),
          isStreaming: true,
        };
        changed = true;
      }
    } else if (e.type === 'agent_settled' || e.type === 'agent_end') {
      if (this._state?.isStreaming) {
        this._state = { ...this._state, isStreaming: false };
        changed = true;
      }
    } else if (e.type === 'compaction_start') {
      this._state = {
        ...(this._state ?? ({} as T.PiState)),
        isCompacting: true,
      };
      changed = true;
    } else if (e.type === 'compaction_end') {
      this._state = {
        ...(this._state ?? ({} as T.PiState)),
        isCompacting: false,
      };
      changed = true;
    }
    if (changed) this.stateEmitter.fire();
  }

  get state(): T.PiState | null {
    return this._state;
  }

  /** Refresh authoritative state via RPC. Call after turn_end. */
  async refreshState(): Promise<T.PiState | null> {
    try {
      this._state = await this.client.getState();
      this.stateEmitter.fire();
      return this._state;
    } catch {
      return this._state;
    }
  }

  /** Get all messages for this session from the RPC client. */
  async getMessages(): Promise<T.AgentMessage[]> {
    try {
      const res = await this.client.getMessages();
      return res.messages;
    } catch {
      return [];
    }
  }

  async prompt(text: string, images?: T.ImageContent[]): Promise<void> {
    await this.client.prompt(text, images ? { images } : undefined);
  }
  async steer(text: string): Promise<void> {
    await this.client.steer(text);
  }
  async abort(): Promise<void> {
    await this.client.abort();
  }
  async setModel(provider: string, modelId: string): Promise<void> {
    await this.client.setModel(provider, modelId);
    await this.refreshState();
  }
  async cycleModel(direction: 'next' | 'prev' = 'next'): Promise<void> {
    await this.client.cycleModel(direction);
    await this.refreshState();
  }
  async setThinkingLevel(level: T.ThinkingLevel): Promise<void> {
    await this.client.setThinkingLevel(level);
    await this.refreshState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventSub?.dispose();
    this.client.dispose();
    this.stateEmitter.dispose();
    this.eventEmitter.dispose();
  }
}
