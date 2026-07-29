/**
 * PiRpcClient — manages the `pi --mode rpc` subprocess and the JSONL protocol.
 *
 * Responsibilities:
 *  - Spawn the child process with the right flags (provider/model/session-dir).
 *  - Read stdout with the LF-only JsonlLineReader (NOT readline).
 *  - Correlate commands/responses by `id`; enforce request timeouts.
 *  - Emit agent events on an `onEvent` vscode.Event for consumers.
 *  - Auto-restart with exponential backoff on crash; queue commands while down.
 *  - Graceful + forceful shutdown on dispose.
 *
 * One PiRpcClient owns one subprocess and one Pi session. The SessionManager
 * creates one per active session tab.
 */

import { type ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import type * as vscode from 'vscode';
import { JsonlLineReader } from './lineReader';
import { RequestQueue } from './requestQueue';
import type * as T from './types';

export interface PiRpcClientOptions {
  /** Path to the `pi` executable (default from settings: "pi"). */
  executable: string;
  /** Extra args appended to `pi --mode rpc` (or to the command when skipModePrefix is true). */
  extraArgs?: string[];
  /** Skip the `--mode rpc` prefix. Used for non-pi subprocesses (e.g., mock server in tests). */
  skipModePrefix?: boolean;
  /** Make start() a no-op — used in tests to avoid spawning subprocesses. */
  skipStart?: boolean;
  /** Cwd for the subprocess — usually the workspace folder. */
  cwd?: string;
  /** Per-request timeout ms (default 30s). */
  requestTimeoutMs?: number;
  /** Enable auto-restart on crash (default true). */
  autoReconnect?: boolean;
  /** Max backoff between restart attempts (default 5s). */
  maxBackoffMs?: number;
  /** Extra environment variables for the child process (deep-merged with process.env). */
  env?: Record<string, string>;
  /** Logger; defaults to console. */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

interface PendingRequest<T = unknown> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  command: string;
  /** Wall-clock ms when the request was sent, for latency tracking. */
  sentAt: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 5_000;

/**
 * A minimal vscode.Event wrapper around an EventEmitter so consumers can
 * subscribe with the familiar `onEvent(handler)` API. We avoid depending on
 * vscode inside the host-layer for testability; the ExtensionContext wires
 * the real vscode.EventEmitter when running in the host. This class is a
 * transport-agnostic emitter.
 */
export class PiEventBus {
  private em = new EventEmitter();
  readonly onEvent: (handler: (e: T.PiEvent) => void) => vscode.Disposable;

  constructor() {
    // Provide a vscode.Event-like surface. We return a lightweight disposable.
    this.onEvent = (handler) => {
      const fn = (e: T.PiEvent) => handler(e);
      this.em.on('event', fn);
      return { dispose: () => this.em.off('event', fn) } as vscode.Disposable;
    };
  }
  fire(e: T.PiEvent): void {
    this.em.emit('event', e);
  }
  dispose(): void {
    this.em.removeAllListeners();
  }
}

export class PiRpcClient implements vscode.Disposable {
  private opts: Required<
    Omit<PiRpcClientOptions, 'extraArgs' | 'cwd' | 'log' | 'env' | 'skipModePrefix' | 'skipStart'>
  > &
    Pick<PiRpcClientOptions, 'extraArgs' | 'cwd' | 'log' | 'env' | 'skipModePrefix' | 'skipStart'>;
  private child: ChildProcess | null = null;
  private reader = new JsonlLineReader();
  private pending = new Map<string, PendingRequest>();
  private queue = new RequestQueue();
  private alive = false;
  private restarting = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private backoffMs = 250;
  private restartCount = 0;
  private static readonly MAX_RESTART_COUNT = 5;
  private disposed = false;

  /** Observability counters (exposed for diagnostics). */
  private totalCommands = 0;
  private totalRestarts = 0;
  private lastRoundTripMs = 0;

  readonly bus = new PiEventBus();

  constructor(opts: PiRpcClientOptions) {
    this.opts = {
      executable: opts.executable || 'pi',
      extraArgs: opts.extraArgs,
      skipModePrefix: opts.skipModePrefix ?? false,
      skipStart: opts.skipStart ?? false,
      cwd: opts.cwd,
      env: opts.env,
      requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      autoReconnect: opts.autoReconnect ?? true,
      maxBackoffMs: opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      log: opts.log,
    };
    this.reader.onRecord((line) => this.onLine(line));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Spawn (or re-spawn) the subprocess. Safe to call repeatedly. */
  start(): void {
    if (this.disposed) return;
    if (this.opts.skipStart) return;
    if (this.restarting) return;
    if (this.child && this.alive) return;
    // Cancel any pending restart since we're starting explicitly.
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.restarting = false;
    }
    const args = this.opts.skipModePrefix
      ? [...(this.opts.extraArgs ?? [])]
      : ['--mode', 'rpc', ...(this.opts.extraArgs ?? [])];
    this.log('info', `spawning ${this.opts.executable} ${args.join(' ')}`);
    const childEnv = this.opts.env ? { ...process.env, ...this.opts.env } : { ...process.env };
    const child = spawn(this.opts.executable, args, {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: Buffer) => this.reader.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) this.log('warn', `[pi stderr] ${text}`);
    });
    child.on('error', (err) => {
      this.log('error', `process error: ${err.message}`);
      this.handleDeath();
    });
    child.on('exit', (code, signal) => {
      this.log('info', `process exited code=${code} signal=${signal}`);
      this.handleDeath();
    });

    this.alive = true;
    this.backoffMs = 250;
    this.restartCount = 0;
    // Drain anything queued while we were down.
    this.drainQueue();
  }

  private handleDeath(): void {
    if (!this.alive) return; // already handling
    this.alive = false;
    this.child = null;
    // Flush any trailing partial line from the reader.
    try {
      this.reader.flush();
    } catch {
      /* ignore */
    }
    if (this.disposed) return;
    if (this.opts.autoReconnect && !this.restarting) {
      this.scheduleRestart();
    } else {
      // Reject pending requests — no process to answer them.
      this.failAllPending(new Error('Pi subprocess exited'));
    }
  }

  private scheduleRestart(): void {
    this.restarting = true;
    this.restartCount++;
    this.totalRestarts++;
    if (this.restartCount > PiRpcClient.MAX_RESTART_COUNT) {
      const errMsg = `Pi subprocess restart limit reached — check that "${this.opts.executable}" is on PATH, or set "pi.path" in VS Code settings`;
      this.log('error', `reached max restart count (${PiRpcClient.MAX_RESTART_COUNT}) — giving up`);
      this.restarting = false;
      this.failAllPending(new Error(errMsg));
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs);
    this.log(
      'info',
      `restarting in ${delay}ms (attempt ${this.restartCount}/${PiRpcClient.MAX_RESTART_COUNT})`,
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restarting = false;
      if (!this.disposed) {
        try {
          this.start();
        } catch (err) {
          this.log('error', `restart failed: ${(err as Error).message}`);
          this.scheduleRestart();
        }
      }
    }, delay);
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;
    const items = this.queue.drain();
    for (const item of items) {
      // If the request already timed out while queued, skip writing it.
      if (Date.now() - item.queuedAt > item.timeoutMs) {
        const p = this.pending.get(item.id);
        if (p) {
          this.pending.delete(item.id);
          clearTimeout(p.timer);
          p.reject(new Error(`Request ${item.command} timed out while queued`));
        }
        continue;
      }
      this.writeLine(item.payload);
    }
  }

  // -------------------------------------------------------------------------
  // Line handling
  // -------------------------------------------------------------------------

  private onLine(line: string): void {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      this.log('warn', `non-JSON line ignored: ${(err as Error).message}`);
      return;
    }
    if (!obj || typeof obj.type !== 'string') return;

    if (obj.type === 'response') {
      this.onResponse(obj as T.RpcResponse);
    } else {
      // Streamed event — fire to all subscribers.
      try {
        this.bus.fire(obj as T.PiEvent);
      } catch (err) {
        this.log('error', `event handler threw for ${obj.type}: ${(err as Error).message}`);
      }
    }
  }

  private onResponse(res: T.RpcResponse): void {
    if (res.id === undefined) {
      this.log('info', `unsolicited response for ${res.command}`);
      return;
    }
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    clearTimeout(p.timer);
    // Record round-trip latency for the last completed request.
    this.lastRoundTripMs = Date.now() - p.sentAt;
    this.totalCommands++;
    if (res.success) {
      p.resolve(res.data);
    } else {
      p.reject(new Error(res.errorMessage || `${p.command} rejected`));
    }
  }

  // -------------------------------------------------------------------------
  // Request machinery
  // -------------------------------------------------------------------------

  /**
   * Send a command and await its `response`. If the process is down and
   * autoReconnect is on, the request is queued until the process returns.
   */
  private request<R = unknown>(cmd: T.RpcCommand): Promise<R> {
    if (this.disposed) return Promise.reject(new Error('client disposed'));
    const id = crypto.randomUUID();
    const command = (cmd as any).type;
    const payloadObj = { id, ...cmd };
    const payload = JSON.stringify(payloadObj);

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          // Also remove from the queue if it's still sitting there.
          this.queue.remove(id);
          reject(new Error(`Request ${command} timed out after ${this.opts.requestTimeoutMs}ms`));
        }
      }, this.opts.requestTimeoutMs);

      const entry: PendingRequest<R> = {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        command,
        sentAt: Date.now(),
      };
      this.pending.set(id, entry as PendingRequest);

      if (this.alive) {
        this.writeLine(payload);
      } else if (this.opts.autoReconnect) {
        // Queue; will be drained when the process restarts.
        this.queue.enqueue<R>({
          id,
          command,
          payload,
          resolve: entry.resolve,
          reject: entry.reject,
          timeoutMs: this.opts.requestTimeoutMs,
        });
      } else {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error('Pi subprocess is not running'));
      }
    });
  }

  private writeLine(line: string): void {
    if (!this.child?.stdin || this.child.stdin.destroyed) {
      this.log('warn', 'write attempted with no live stdin');
      return;
    }
    this.child.stdin.write(line + '\n', (err) => {
      if (err) this.log('error', `stdin write failed: ${err.message}`);
    });
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.queue.clear(err);
  }

  // -------------------------------------------------------------------------
  // Public RPC API (typed wrappers)
  // -------------------------------------------------------------------------

  async prompt(
    message: string,
    opts?: {
      images?: T.ImageContent[];
      streamingBehavior?: T.StreamingBehavior;
    },
  ): Promise<void> {
    await this.request<void>({ type: 'prompt', message, ...opts });
  }
  async steer(message: string, opts?: { images?: T.ImageContent[] }): Promise<void> {
    await this.request<void>({ type: 'steer', message, ...opts });
  }
  async followUp(message: string, opts?: { images?: T.ImageContent[] }): Promise<void> {
    await this.request<void>({ type: 'follow_up', message, ...opts });
  }
  async abort(): Promise<void> {
    await this.request<void>({ type: 'abort' });
  }
  async newSession(parent?: string): Promise<T.NewSessionData> {
    return this.request<T.NewSessionData>({
      type: 'new_session',
      parentSession: parent,
    });
  }
  async getState(): Promise<T.PiState> {
    return this.request<T.PiState>({ type: 'get_state' });
  }
  async getMessages(): Promise<{ messages: T.AgentMessage[] }> {
    return this.request<{ messages: T.AgentMessage[] }>({
      type: 'get_messages',
    });
  }
  async setModel(provider: string, modelId: string): Promise<T.ModelInfo> {
    return this.request<T.ModelInfo>({ type: 'set_model', provider, modelId });
  }
  async cycleModel(direction: 'next' | 'prev' = 'next'): Promise<T.CycleModelData> {
    return this.request<T.CycleModelData>({ type: 'cycle_model', direction });
  }
  async getAvailableModels(): Promise<T.AvailableModelsData> {
    return this.request<T.AvailableModelsData>({
      type: 'get_available_models',
    });
  }
  async setThinkingLevel(level: T.ThinkingLevel): Promise<void> {
    await this.request<void>({ type: 'set_thinking_level', level });
  }
  async setSessionName(name: string): Promise<void> {
    await this.request<void>({ type: 'set_session_name', name });
  }

  /** Fire-and-forget prompt used for slash commands like /login. */
  async sendSlashCommand(command: string): Promise<void> {
    await this.prompt(command);
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Subscribe to streamed events. */
  onEvent(handler: (e: T.PiEvent) => void): vscode.Disposable {
    return this.bus.onEvent(handler);
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  /** Number of RPC commands successfully completed (lifetime). */
  get commandCount(): number {
    return this.totalCommands;
  }

  /** Number of subprocess restarts since construction. */
  get restartCountTotal(): number {
    return this.totalRestarts;
  }

  /** Last successful round-trip time in ms. */
  get roundTripMs(): number {
    return this.lastRoundTripMs;
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.restarting = false;
    }
    this.failAllPending(new Error('client disposed'));
    this.bus.dispose();
    const child = this.child;
    if (child) {
      // Best-effort graceful: SIGTERM, then SIGKILL after 2s.
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 2000);
      child.once('exit', () => clearTimeout(killTimer));
    }
    this.child = null;
    this.alive = false;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    const l = this.opts.log;
    if (l) l(level, msg);
  }
}
