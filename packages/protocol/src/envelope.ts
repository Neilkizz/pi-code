export const DESKTOP_PROTOCOL_VERSION = 2 as const;
export const DESKTOP_PROTOCOL_MIN_VERSION = 2 as const;

export type ProtocolFeature =
  | "endpoint-runtime"
  | "resource-profiles"
  | "session-resume"
  | "task-events"
  | "permission-modes-v2"
  | "capability-broker-v1"
  | "managed-extension-worker-v1"
  | "per-task-worker-v1"
  | "snapshot-delta"
  | "sessions-tree";

export interface DesktopCommandMetadata {
  protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  messageId: string;
  idempotencyKey: string;
  timestamp: number;
}

export interface HostMessageMetadata {
  protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  messageId: string;
  correlationId?: string;
  taskId?: string;
  workerId?: string;
  seq?: number;
  timestamp: number;
}

export interface ProtocolHello {
  minVersion: number;
  maxVersion: number;
  selectedVersion: number;
  hostVersion: string;
  features: ProtocolFeature[];
}

export function createDesktopCommand<TPayload extends { type: string }>(
  payload: TPayload,
  options: {
    messageId?: string;
    idempotencyKey?: string;
    timestamp?: number;
  } = {},
): DesktopCommandMetadata & TPayload {
  const messageId = options.messageId ?? protocolId("command");
  return {
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    messageId,
    idempotencyKey: options.idempotencyKey ?? messageId,
    timestamp: options.timestamp ?? Date.now(),
    ...payload,
  };
}

export function createHostMessage<TPayload extends { type: string }>(
  payload: TPayload,
  options: {
    messageId?: string;
    correlationId?: string;
    taskId?: string;
    workerId?: string;
    seq?: number;
    timestamp?: number;
  } = {},
): HostMessageMetadata & TPayload {
  return {
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    messageId: options.messageId ?? protocolId("event"),
    correlationId: options.correlationId,
    taskId: options.taskId,
    workerId: options.workerId,
    seq: options.seq,
    timestamp: options.timestamp ?? Date.now(),
    ...payload,
  };
}

function protocolId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `${prefix}-${randomUuid}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
