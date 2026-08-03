export interface PromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

export type PromptStreamingBehavior = "steer" | "followUp";

export interface PromptSession {
  prompt(
    prompt: string,
    options?: {
      images?: PromptImage[];
      streamingBehavior?: PromptStreamingBehavior;
    },
  ): Promise<void>;
  abort(): Promise<void>;
  clearQueue?(): { steering: string[]; followUp: string[] };
}

type TaskRunStatus = "idle" | "running" | "completed" | "failed";
type StatusListener = (status: TaskRunStatus, error?: string) => void;

export class TaskRunController {
  private generation = 0;
  private active = false;

  constructor(
    private readonly session: PromptSession,
    private readonly onStatus: StatusListener,
    private readonly onAbortPending: () => void,
  ) {}

  start(
    prompt: string,
    images: PromptImage[] = [],
    streamingBehavior?: PromptStreamingBehavior,
  ): { accepted: true; queued?: boolean } {
    if (this.active) {
      if (!streamingBehavior) {
        throw new Error("Task is already running");
      }
      // The SDK already has a run in progress; queue this as a steer/follow-up.
      // The SDK returns immediately once the message is enqueued.
      void this.session.prompt(
        prompt,
        images.length > 0
          ? { images, streamingBehavior }
          : { streamingBehavior },
      );
      return { accepted: true, queued: true };
    }

    this.active = true;
    const generation = ++this.generation;
    this.onStatus("running");
    void this.execute(generation, prompt, images);
    return { accepted: true };
  }

  async clearQueue(): Promise<void> {
    if (this.session.clearQueue) {
      this.session.clearQueue();
    }
  }

  async abort(): Promise<void> {
    const wasActive = this.active;
    this.generation += 1;
    this.active = false;
    this.onAbortPending();
    await this.clearQueue();
    if (wasActive) {
      await this.session.abort();
    }
    this.onStatus("idle");
  }

  get isActive(): boolean {
    return this.active;
  }

  private async execute(
    generation: number,
    prompt: string,
    images: PromptImage[],
  ): Promise<void> {
    try {
      await this.session.prompt(
        prompt,
        images.length > 0 ? { images } : undefined,
      );
      if (generation === this.generation) {
        this.active = false;
        this.onStatus("completed");
      }
    } catch (error: unknown) {
      if (generation === this.generation) {
        this.active = false;
        this.onStatus(
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
