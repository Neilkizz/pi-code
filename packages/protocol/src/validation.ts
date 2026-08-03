import { DESKTOP_PROTOCOL_VERSION } from "./envelope.js";
import type {
  DesktopToHostMessage,
  EndpointRuntimeConfig,
  TaskRuntimeProfile,
} from "./messages.js";

export type ProtocolDecodeResult =
  | { ok: true; message: DesktopToHostMessage }
  | {
      ok: false;
      error: {
        code: "INVALID_MESSAGE" | "PROTOCOL_VERSION_UNSUPPORTED";
        message: string;
        correlationId?: string;
      };
    };

export function decodeDesktopToHostMessage(
  input: unknown,
): ProtocolDecodeResult {
  if (!isRecord(input)) {
    return invalid("Message must be a JSON object");
  }

  const correlationId =
    typeof input.messageId === "string" ? input.messageId : undefined;
  if (input.protocolVersion !== DESKTOP_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: "PROTOCOL_VERSION_UNSUPPORTED",
        message: `Unsupported protocol version: ${String(
          input.protocolVersion,
        )}; expected ${DESKTOP_PROTOCOL_VERSION}`,
        correlationId,
      },
    };
  }
  if (!nonEmptyString(input.messageId)) {
    return invalid("messageId must be a non-empty string");
  }
  if (!nonEmptyString(input.idempotencyKey)) {
    return invalid("idempotencyKey must be a non-empty string", correlationId);
  }
  if (
    typeof input.timestamp !== "number" ||
    !Number.isFinite(input.timestamp) ||
    input.timestamp <= 0
  ) {
    return invalid("timestamp must be a positive number", correlationId);
  }
  if (!nonEmptyString(input.type)) {
    return invalid("type must be a non-empty string", correlationId);
  }

  switch (input.type) {
    case "host.bootstrap":
      if (!nonEmptyString(input.appDataDir)) {
        return invalid("appDataDir is required", correlationId);
      }
      break;
    case "host.configureEndpoints":
      if (
        !Array.isArray(input.endpoints) ||
        !input.endpoints.every(isEndpointRuntimeConfig)
      ) {
        return invalid("endpoints must contain valid endpoint configs", correlationId);
      }
      break;
    case "host.configureExtensions":
      if (
        !Array.isArray(input.extensions) ||
        !input.extensions.every(
          (extension) =>
            isRecord(extension) &&
            nonEmptyString(extension.id) &&
            nonEmptyString(extension.name) &&
            nonEmptyString(extension.installPath) &&
            nonEmptyString(extension.contentHash),
        )
      ) {
        return invalid(
          "extensions must contain complete immutable runtime configs",
          correlationId,
        );
      }
      break;
    case "task.create":
      if (
        !uuidString(input.taskId) ||
        !nonEmptyString(input.cwd) ||
        !isTaskIsolation(input.isolation) ||
        !isTaskRuntimeProfile(input.profile) ||
        (input.projectInstructions !== undefined &&
          (typeof input.projectInstructions !== "string" ||
            input.projectInstructions.length > 32_768)) ||
        typeof input.resume !== "boolean"
      ) {
        return invalid("task.create payload is invalid", correlationId);
      }
      break;
    case "broker.response":
      if (
        !uuidString(input.taskId) ||
        !nonEmptyString(input.requestId) ||
        typeof input.ok !== "boolean" ||
        (input.ok === false &&
          (!isRecord(input.error) || !nonEmptyString(input.error.message)))
      ) {
        return invalid("broker.response payload is invalid", correlationId);
      }
      break;
    case "task.prompt":
      if (
        !uuidString(input.taskId) ||
        !nonEmptyString(input.prompt) ||
        !Array.isArray(input.attachments) ||
        !input.attachments.every(isTaskPromptAttachment) ||
        (input.streamingBehavior !== undefined &&
          input.streamingBehavior !== "steer" &&
          input.streamingBehavior !== "followUp")
      ) {
        return invalid("task.prompt payload is invalid", correlationId);
      }
      break;
    case "task.abort":
    case "task.close":
    case "task.getTree":
    case "task.promptQueueClear":
      if (!uuidString(input.taskId)) {
        return invalid(`${input.type} requires a UUID taskId`, correlationId);
      }
      break;
    case "task.permission.respond":
      if (
        !uuidString(input.taskId) ||
        !nonEmptyString(input.requestId) ||
        typeof input.approved !== "boolean"
      ) {
        return invalid(
          "task.permission.respond payload is invalid",
          correlationId,
        );
      }
      break;
    default:
      return invalid(`Unknown message type: ${input.type}`, correlationId);
  }

  return { ok: true, message: input as unknown as DesktopToHostMessage };
}

function isTaskPromptAttachment(value: unknown): boolean {
  return (
    isRecord(value) &&
    uuidString(value.id) &&
    (value.kind === "file" ||
      value.kind === "image" ||
      value.kind === "pdf") &&
    nonEmptyString(value.name) &&
    nonEmptyString(value.path) &&
    nonEmptyString(value.mimeType) &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    value.size <= 25 * 1024 * 1024 &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/i.test(value.sha256)
  );
}

function isTaskIsolation(value: unknown): boolean {
  return (
    value === "worktree" ||
    value === "currentCheckout" ||
    value === "readOnly"
  );
}

function isEndpointRuntimeConfig(
  value: unknown,
): value is EndpointRuntimeConfig {
  if (!isRecord(value)) {
    return false;
  }
  return (
    nonEmptyString(value.id) &&
    nonEmptyString(value.name) &&
    (value.kind === "openai-compatible" ||
      value.kind === "anthropic-compatible" ||
      value.kind === "ollama") &&
    nonEmptyString(value.baseUrl) &&
    (value.apiKey === undefined || typeof value.apiKey === "string") &&
    Array.isArray(value.models) &&
    value.models.every(nonEmptyString)
  );
}

function isTaskRuntimeProfile(value: unknown): value is TaskRuntimeProfile {
  if (!isRecord(value)) {
    return false;
  }
  const hasProvider = nonEmptyString(value.providerId);
  const hasModel = nonEmptyString(value.modelId);
  return (
    (value.permissionMode === "ask" ||
      value.permissionMode === "acceptEdits" ||
      value.permissionMode === "plan" ||
      value.permissionMode === "auto") &&
    hasProvider === hasModel
  );
}

function uuidString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  message: string,
  correlationId?: string,
): ProtocolDecodeResult {
  return {
    ok: false,
    error: { code: "INVALID_MESSAGE", message, correlationId },
  };
}
