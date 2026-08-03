import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  DesktopToHostMessage,
  HostToDesktopMessage,
} from "@pi-desktop/protocol";
import {
  createHostMessage,
  decodeDesktopToHostMessage,
} from "@pi-desktop/protocol";

export class JsonlTransport {
  private readonly input: Readable;
  private readonly output: Writable;
  private listener?: (message: DesktopToHostMessage) => Promise<void>;
  private pending = Promise.resolve();

  constructor(input: Readable, output: Writable) {
    this.input = input;
    this.output = output;
  }

  onMessage(listener: (message: DesktopToHostMessage) => Promise<void>): void {
    this.listener = listener;
  }

  start(): void {
    const lines = createInterface({ input: this.input, crlfDelay: Infinity });

    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed || !this.listener) {
        return;
      }

      try {
        const decoded = decodeDesktopToHostMessage(JSON.parse(trimmed));
        if (!decoded.ok) {
          this.send(
            createHostMessage(
              {
                type: "response",
                ok: false,
                error: {
                  code: decoded.error.code,
                  message: decoded.error.message,
                },
              },
              { correlationId: decoded.error.correlationId },
            ),
          );
          return;
        }
        const message = decoded.message;
        this.pending = this.pending
          .then(() => this.listener?.(message))
          .catch((error: unknown) => {
            this.send(
              createHostMessage(
                {
                  type: "response",
                  ok: false,
                  error: {
                    code: "HOST_HANDLER_ERROR",
                    message:
                      error instanceof Error ? error.message : String(error),
                  },
                },
                { correlationId: message.messageId },
              ),
            );
          });
      } catch (error: unknown) {
        this.send(
          createHostMessage({
            type: "response",
            ok: false,
            error: {
              code: "INVALID_JSON",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      }
    });
  }

  send(message: HostToDesktopMessage): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }
}
