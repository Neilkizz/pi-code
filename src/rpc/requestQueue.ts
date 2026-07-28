/**
 * RequestQueue — a FIFO of outbound RPC commands held while the Pi subprocess
 * is dead or restarting. Drained in order once the client is alive again.
 *
 * Each entry stores the serialized command and its resolver pair so that
 * `PiRpcClient` can replay (or fail) them when the process comes back.
 */

export interface QueuedRequest<T = unknown> {
  id: string;
  command: string;
  payload: string; // serialized JSON line
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  /** Wall-clock ms when queued, used to honor timeouts while sitting in the queue. */
  queuedAt: number;
  /** Per-request timeout ms (inherited from the client default). */
  timeoutMs: number;
}

export class RequestQueue {
  private items: QueuedRequest[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get length(): number {
    return this.items.length;
  }

  enqueue<T>(req: Omit<QueuedRequest<T>, "queuedAt">): void {
    if (this.items.length >= this.maxSize) {
      // Drop oldest first — it's the least likely to still be relevant.
      const dropped = this.items.shift()!;
      dropped.reject(new Error("Request queue full — request dropped"));
    }
    this.items.push({ ...(req as QueuedRequest), queuedAt: Date.now() });
  }

  /** Remove and return all entries, preserving FIFO order. */
  drain(): QueuedRequest[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  /** Reject and drop a specific request (e.g. on shutdown). */
  remove(id: string): QueuedRequest | undefined {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return undefined;
    return this.items.splice(idx, 1)[0];
  }

  /** Reject and drop everything (e.g. on final disposal). */
  clear(err: Error): void {
    for (const item of this.items) {
      item.reject(err);
    }
    this.items = [];
  }
}
