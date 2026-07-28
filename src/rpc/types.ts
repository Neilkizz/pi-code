/**
 * Type definitions for the Pi RPC protocol (JSONL over stdio).
 *
 * Verified against https://pi.dev/docs/latest/rpc and /json.
 * Framing: strict JSONL with LF (\n) as the only record delimiter.
 * Node's `readline` is NOT protocol-compliant (splits on U+2028/U+2029
 * which are valid inside JSON strings). Use `JsonlLineReader`.
 */

// ---------------------------------------------------------------------------
// Image content (used by prompt / steer / follow_up)
// ---------------------------------------------------------------------------

export interface ImageContent {
  type: "image";
  data: string; // base64-encoded
  mimeType: string; // e.g. "image/png"
}

// ---------------------------------------------------------------------------
// Commands (client -> pi stdin)
// ---------------------------------------------------------------------------

export type StreamingBehavior = "steer" | "followUp";

interface WithId {
  id?: string;
}

export interface PromptCommand extends WithId {
  type: "prompt";
  message: string;
  images?: ImageContent[];
  /** Required when the agent is already streaming. */
  streamingBehavior?: StreamingBehavior;
}

export interface SteerCommand extends WithId {
  type: "steer";
  message: string;
  images?: ImageContent[];
}

export interface FollowUpCommand extends WithId {
  type: "follow_up";
  message: string;
  images?: ImageContent[];
}

export interface AbortCommand extends WithId {
  type: "abort";
}

export interface NewSessionCommand extends WithId {
  type: "new_session";
  parentSession?: string;
}

export interface GetStateCommand extends WithId {
  type: "get_state";
}

export interface GetMessagesCommand extends WithId {
  type: "get_messages";
}

export interface SetModelCommand extends WithId {
  type: "set_model";
  provider: string;
  modelId: string;
}

export interface CycleModelCommand extends WithId {
  type: "cycle_model";
  direction?: "next" | "prev";
}

export interface GetAvailableModelsCommand extends WithId {
  type: "get_available_models";
}

export interface SetThinkingLevelCommand extends WithId {
  type: "set_thinking_level";
  level: ThinkingLevel;
}

export interface SetSessionNameCommand extends WithId {
  type: "set_session_name";
  name: string;
}

export type RpcCommand =
  | PromptCommand
  | SteerCommand
  | FollowUpCommand
  | AbortCommand
  | NewSessionCommand
  | GetStateCommand
  | GetMessagesCommand
  | SetModelCommand
  | CycleModelCommand
  | GetAvailableModelsCommand
  | SetThinkingLevelCommand
  | SetSessionNameCommand;

// ---------------------------------------------------------------------------
// Responses (pi stdout -> client); correlated by id when provided.
// ---------------------------------------------------------------------------

export interface RpcResponse<T = unknown> {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: T;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Response data shapes (typed where we rely on them)
// ---------------------------------------------------------------------------

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
  id: string;
  provider: string;
  label?: string;
  [key: string]: unknown;
}

export interface PiState {
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode?: string;
  followUpMode?: string;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  autoCompactionEnabled?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
}

export interface NewSessionData {
  cancelled: boolean;
}

export interface CycleModelData {
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
}

export interface AvailableModelsData {
  models: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Streamed events (pi stdout -> client); NOT responses.
// ---------------------------------------------------------------------------

export interface AgentStartEvent {
  type: "agent_start";
}
export interface AgentEndEvent {
  type: "agent_end";
  messages: AgentMessage[];
}
export interface AgentSettledEvent {
  type: "agent_settled";
}
export interface TurnStartEvent {
  type: "turn_start";
}
export interface TurnEndEvent {
  type: "turn_end";
  message: AgentMessage;
  toolResults: ToolResultMessage[];
}
export interface MessageStartEvent {
  type: "message_start";
  message: AgentMessage;
}
export interface MessageUpdateEvent {
  type: "message_update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}
export interface MessageEndEvent {
  type: "message_end";
  message: AgentMessage;
}

export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: any;
}
export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: any;
  partialResult: any;
}
export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  isError: boolean;
}

export interface QueueUpdateEvent {
  type: "queue_update";
  steering: string[];
  followUp: string[];
}
export interface CompactionStartEvent {
  type: "compaction_start";
  reason: "manual" | "threshold" | "overflow";
}
export interface CompactionEndEvent {
  type: "compaction_end";
  reason: "manual" | "threshold" | "overflow";
  result: unknown;
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}
export interface AutoRetryStartEvent {
  type: "auto_retry_start";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}
export interface AutoRetryEndEvent {
  type: "auto_retry_end";
  success: boolean;
  attempt: number;
  finalError?: string;
}
export interface ExtensionErrorEvent {
  type: "extension_error";
  [key: string]: unknown;
}
export interface BashExecutionUpdateEvent {
  type: "bash_execution_update";
  /** id of the originating bash command */
  id?: string;
  /** Streamed output text from the executing bash command. */
  output?: string;
  [key: string]: unknown;
}

/**
 * Discriminated union of all streamed events. Anything else (unknown types)
 * is normalised to { type: string, [k]: unknown } by the reader.
 */
export type PiEvent =
  | AgentStartEvent
  | AgentEndEvent
  | AgentSettledEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | QueueUpdateEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | AutoRetryStartEvent
  | AutoRetryEndEvent
  | ExtensionErrorEvent
  | BashExecutionUpdateEvent
  | ({ type: string } & Record<string, unknown>);

// ---------------------------------------------------------------------------
// Message types (from get_messages / events)
// ---------------------------------------------------------------------------

export interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface UserMessage {
  role: "user";
  content: ContentBlock[] | string;
  [key: string]: unknown;
}
export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  [key: string]: unknown;
}
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  isError: boolean;
  timestamp: number;
  [key: string]: unknown;
}
export interface BashExecutionMessage {
  role: "bashExecution";
  [key: string]: unknown;
}
export interface CustomMessage {
  role: string;
  [key: string]: unknown;
}
export interface BranchSummaryMessage {
  role: "branchSummary";
  [key: string]: unknown;
}
export interface CompactionSummaryMessage {
  role: "compactionSummary";
  [key: string]: unknown;
}
export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage
  | CustomMessage;

// ---------------------------------------------------------------------------
// Assistant message streaming deltas
// ---------------------------------------------------------------------------

export interface TextDeltaEvent {
  type: "text_delta";
  delta: string;
}
export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  delta: string;
}
export type AssistantMessageEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ({ type: string } & Record<string, unknown>);

// ---------------------------------------------------------------------------
// Tool result details
// ---------------------------------------------------------------------------

/** `details` returned by the `edit` tool. */
export interface EditToolDetails {
  /** Display-oriented diff of the changes made. */
  diff: string;
  /** Standard unified patch. */
  patch: string;
  /** Line number of the first change in the new file (for editor navigation). */
  firstChangedLine?: number;
}

export interface ToolResult {
  content: ContentBlock[];
  details?: Record<string, unknown>;
}
