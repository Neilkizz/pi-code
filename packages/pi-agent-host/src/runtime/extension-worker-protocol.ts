import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_WIRE_BYTES = 2 * 1024 * 1024;

export function encodeAuthenticated(
  secret: string,
  payload: Record<string, unknown>,
): string {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX_WIRE_BYTES) {
    throw new Error("Managed Extension message exceeds the 2 MiB limit");
  }
  return `${JSON.stringify({ body, mac: sign(secret, body) })}\n`;
}

export function decodeAuthenticated(
  secret: string,
  line: string,
): Record<string, unknown> {
  if (Buffer.byteLength(line) > MAX_WIRE_BYTES) {
    throw new Error("Managed Extension message exceeds the 2 MiB limit");
  }
  const wire = JSON.parse(line) as { body?: unknown; mac?: unknown };
  if (typeof wire.body !== "string" || typeof wire.mac !== "string") {
    throw new Error("Managed Extension message is not authenticated");
  }
  const expected = Buffer.from(sign(secret, wire.body), "hex");
  const received = Buffer.from(wire.mac, "hex");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new Error("Managed Extension message authentication failed");
  }
  const payload = JSON.parse(wire.body) as unknown;
  if (!isRecord(payload)) {
    throw new Error("Managed Extension message payload must be an object");
  }
  return payload;
}

export function appendBoundedLines(
  current: string,
  chunk: Buffer | string,
): { buffer: string; lines: string[] } {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next) > MAX_WIRE_BYTES * 2) {
    throw new Error("Managed Extension emitted an oversized protocol line");
  }
  const parts = next.split("\n");
  return {
    buffer: parts.pop() ?? "",
    lines: parts.filter((line) => line.length > 0),
  };
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
