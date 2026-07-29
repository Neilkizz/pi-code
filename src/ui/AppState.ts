import type {
  PiEvent,
  AgentMessage,
  MessageStartEvent,
  MessageUpdateEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
  MessageEndEvent,
  CompactionStartEvent,
  CompactionEndEvent,
  ToolResultMessage,
  AssistantMessageEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
} from '../rpc/types';
import type { SessionItem } from './HeaderBar';

export interface DisplayMessage {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'tool-end' | 'compaction';
  text: string;
  thinkingText?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: string;
  isStreaming?: boolean;
  message?: AgentMessage;
}

export function reduceMessages(prev: DisplayMessage[], event: PiEvent): DisplayMessage[] {
  const next = prev.slice();
  switch (event.type) {
    case 'message_start': {
      const e = event as MessageStartEvent;
      if (e.message.role === 'user') {
        next.push({ id: `msg-${Date.now()}`, kind: 'user', text: textFromMsg(e.message) });
      }
      if (e.message.role === 'assistant') {
        next.push({
          id: `msg-${Date.now()}`,
          kind: 'assistant',
          text: '',
          message: e.message,
          isStreaming: true,
        });
      }
      break;
    }
    case 'message_update': {
      const e = event as MessageUpdateEvent;
      const last = next[next.length - 1];
      if (!last || !last.isStreaming) break;
      switch (e.assistantMessageEvent.type) {
        case 'text_delta':
          last.text += e.assistantMessageEvent.delta;
          break;
        case 'thinking_delta':
          last.thinkingText = (last.thinkingText ?? '') + e.assistantMessageEvent.delta;
          break;
      }
      break;
    }
    case 'message_end': {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].isStreaming) {
          next[i] = { ...next[i], isStreaming: false };
          break;
        }
      }
      break;
    }
    case 'tool_execution_start': {
      const e = event as ToolExecutionStartEvent;
      next.push({
        id: `tool-${e.toolCallId}`,
        kind: 'tool',
        text: `args: ${JSON.stringify(e.args, null, 2)}`,
        toolName: e.toolName,
        toolCallId: e.toolCallId,
        toolStatus: 'running',
      });
      break;
    }
    case 'tool_execution_update': {
      const e = event as ToolExecutionUpdateEvent;
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i];
        if (m.kind === 'tool' && m.toolCallId === e.toolCallId && m.toolStatus === 'running') {
          next[i] = { ...m, text: textFromResult(e.partialResult), isStreaming: true };
          break;
        }
      }
      break;
    }
    case 'tool_execution_end': {
      const e = event as ToolExecutionEndEvent;
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i];
        if (m.kind === 'tool' && m.toolCallId === e.toolCallId && m.toolStatus === 'running') {
          next[i] = {
            ...m,
            kind: 'tool-end',
            text: textFromResult(e.result),
            toolStatus: e.isError ? 'error' : 'done',
            isStreaming: false,
          };
          break;
        }
      }
      break;
    }
    case 'compaction_start':
    case 'compaction_end':
      next.push({
        id: `comp-${Date.now()}`,
        kind: 'compaction',
        text: event.type === 'compaction_start' ? 'Context compacting…' : 'Context compacted',
      });
      break;
  }
  for (const msg of next) {
    if (msg.text && msg.text.length > 50000)
      msg.text = msg.text.slice(0, 50000) + '\n\n[...truncated at 50K chars]';
    if (msg.thinkingText && msg.thinkingText.length > 50000)
      msg.thinkingText = msg.thinkingText.slice(0, 50000) + '\n\n[...truncated]';
  }
  if (next.length > 200) next.splice(0, next.length - 200);
  return next;
}

export function textFromMsg(msg: AgentMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.map((c: any) => c.text ?? '').join('\n');
  return '';
}

export function textFromResult(pr: any): string {
  if (!pr) return '';
  if (typeof pr === 'string') return pr;
  if (Array.isArray(pr.content)) return pr.content.map((c: any) => c.text ?? '').join('\n');
  return JSON.stringify(pr, null, 2);
}

export function convertAgentMessages(messages: AgentMessage[]): DisplayMessage[] {
  const next: DisplayMessage[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      next.push({ id: `msg-user-${messageIndex}`, kind: 'user', text: textFromMsg(message) });
    } else if (message.role === 'assistant') {
      let currentAssistant: DisplayMessage | null = null;
      const content = Array.isArray(message.content) ? message.content : [];
      content.forEach((block: any, bi: number) => {
        if (block.type === 'text' || block.type === 'thinking') {
          if (!currentAssistant)
            currentAssistant = {
              id: `msg-assistant-${messageIndex}-${bi}`,
              kind: 'assistant',
              text: '',
              thinkingText: '',
            };
          if (block.type === 'text') currentAssistant.text += block.text ?? '';
          else currentAssistant.thinkingText += block.text ?? '';
        } else if (block.type === 'toolCall') {
          if (currentAssistant) {
            next.push(currentAssistant);
            currentAssistant = null;
          }
          next.push({
            id: `tool-${block.toolCallId}`,
            kind: 'tool',
            text: `args: ${JSON.stringify(block.args, null, 2)}`,
            toolName: block.name || block.toolName,
            toolCallId: block.toolCallId,
            toolStatus: 'running',
          });
        }
      });
      if (currentAssistant) next.push(currentAssistant);
    } else if (message.role === 'toolResult') {
      const msg = message as ToolResultMessage;
      const idx = next.findIndex((m) => m.toolCallId === msg.toolCallId);
      if (idx !== -1)
        next[idx] = {
          ...next[idx],
          kind: 'tool-end',
          text: textFromResult(msg),
          toolStatus: msg.isError ? 'error' : 'done',
        };
      else
        next.push({
          id: `tool-${msg.toolCallId}`,
          kind: 'tool-end',
          text: textFromResult(msg),
          toolName: msg.toolName,
          toolCallId: msg.toolCallId,
          toolStatus: msg.isError ? 'error' : 'done',
        });
    } else if (message.role === 'compactionSummary') {
      next.push({ id: `comp-${messageIndex}`, kind: 'compaction', text: 'Context compacted' });
    } else if (message.role === 'branchSummary') {
      next.push({ id: `comp-${messageIndex}`, kind: 'compaction', text: 'Session branched' });
    }
  });
  return next;
}

export function formatSelectionBadge(lineCount: number, visible: boolean): string {
  if (lineCount <= 0 || !visible) return '';
  return `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} selected`;
}

export type AppAction =
  | { kind: 'piEvent'; sessionId: string; event: PiEvent }
  | { kind: 'stateSnapshot'; sessionId: string; model: string; thinkingLevel: string; isStreaming: boolean; sessionName: string; messageCount: number }
  | { kind: 'history'; sessionId: string; messages: AgentMessage[] }
  | { kind: 'fileSuggestions'; files: string[] }
  | { kind: 'modelList'; models: { provider: string; id: string }[] }
  | { kind: 'contextUpdate'; items: { label: string }[] }
  | { kind: 'gitStatus'; branch: string; added: number; deleted: number; modified: number }
  | { kind: 'changeSummary'; summary: string }
  | { kind: 'selectSession'; sessionId: string }
  | { kind: 'commandPreview'; command: string; risk: 'safe' | 'sensitive' | 'dangerous'; reason?: string; previewId: string }
  | { kind: 'clearPreview' };

export interface AppState {
  activeSessionId: string | null;
  messages: DisplayMessage[];
  isStreaming: boolean;
  model: string;
  thinking: string;
  suggestions: string[];
  contextItems: string[];
  gitBranch: string;
  gitChanges: string;
  changeSummary: string;
  sessionName: string;
  sessions: SessionItem[];
  pendingConfirmation: {
    command: string;
    risk: 'safe' | 'sensitive' | 'dangerous';
    reason?: string;
    previewId: string;
  } | null;
}

export const initialState: AppState = {
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  model: '',
  thinking: 'medium',
  suggestions: [],
  contextItems: [],
  gitBranch: '',
  gitChanges: '',
  changeSummary: '',
  sessionName: '',
  sessions: [],
  pendingConfirmation: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.kind) {
    case 'piEvent': {
      if (action.sessionId !== state.activeSessionId) return state;
      return {
        ...state,
        messages: reduceMessages(state.messages, action.event),
      };
    }
    case 'stateSnapshot': {
      const isNew = action.sessionId !== state.activeSessionId;
      if (isNew) {
        return {
          ...state,
          activeSessionId: action.sessionId,
          messages: [],
          model: action.model ? `${action.model}` : '—',
          thinking: action.thinkingLevel,
          isStreaming: action.isStreaming,
          sessionName: action.sessionName,
        };
      }
      return {
        ...state,
        model: action.model ? `${action.model}` : '—',
        thinking: action.thinkingLevel,
        isStreaming: action.isStreaming,
      };
    }
    case 'history': {
      if (action.sessionId !== state.activeSessionId) return state;
      return {
        ...state,
        messages: convertAgentMessages(action.messages),
      };
    }
    case 'fileSuggestions': {
      return {
        ...state,
        suggestions: action.files,
      };
    }
    case 'modelList': {
      return {
        ...state,
        suggestions: action.models.map((m) => `${m.provider}/${m.id}`),
      };
    }
    case 'contextUpdate': {
      return {
        ...state,
        contextItems: action.items.map((i) => i.label),
      };
    }
    case 'gitStatus': {
      return {
        ...state,
        gitBranch: action.branch,
        gitChanges: `+${action.added}/-${action.deleted} ~${action.modified}`,
      };
    }
    case 'changeSummary': {
      return {
        ...state,
        changeSummary: action.summary,
      };
    }
    case 'selectSession': {
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: [],
        pendingConfirmation: null,
      };
    }
    case 'commandPreview': {
      return {
        ...state,
        pendingConfirmation: {
          command: action.command,
          risk: action.risk,
          reason: action.reason,
          previewId: action.previewId,
        },
      };
    }
    case 'clearPreview': {
      return {
        ...state,
        pendingConfirmation: null,
      };
    }
    default:
      return state;
  }
}

// Re-export types for backward compatibility with tests during transition
export type { PiEvent, AgentMessage, MessageStartEvent, MessageUpdateEvent, MessageEndEvent, ToolExecutionStartEvent, ToolExecutionUpdateEvent, ToolExecutionEndEvent, CompactionStartEvent, CompactionEndEvent, ToolResultMessage, AssistantMessageEvent, TextDeltaEvent, ThinkingDeltaEvent } from '../rpc/types';
export type { SessionItem } from './HeaderBar';