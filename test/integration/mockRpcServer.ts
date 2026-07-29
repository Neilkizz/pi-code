/**
 * Mock Pi RPC server — a Node.js process that speaks JSONL over stdio,
 * simulating `pi --mode rpc` behaviour for integration testing.
 *
 * Behaviour is selected by the MOCK_SCENARIO env var:
 *   echo        — respond immediately to every command with success
 *   events      — for "prompt" commands, emit a stream of events before responding
 *   garbage     — write random garbage lines before the normal response
 *   slow        — delay response by 5 seconds (for timeout tests)
 *   crash       — exit(1) after processing the first command
 *   endless     — never respond (simulates a hung process)
 *   env-echo    — respond with selected env variables in data.env
 *   dual-tools  — interleave two tool executions during prompt
 *   chunks      — write a JSON response across 3 partial writes to stdout
 *   banner      — write 2 non-JSON lines before valid response
 *   multi-session — track session id -> state map
 *   u2028-test  — embed U+2028 / U+2029 in response data
 *
 * Usage (spawned as child process, NOT run directly):
 *   node -r ts-node/register test/integration/mockRpcServer.ts
 */

import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Mock event sequences
// ---------------------------------------------------------------------------
function makeEventSequence(): object[] {
  return [
    { type: 'agent_start' },
    {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    },
    {
      type: 'message_update',
      message: { role: 'assistant' },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    },
    {
      type: 'message_end',
      message: { role: 'assistant', content: [{ text: 'Hello' }] },
    },
    { type: 'agent_end', messages: [] },
  ];
}

function makeToolEventSequence(): object[] {
  const callEdit1 = 'call_' + crypto.randomUUID().slice(0, 8);
  const callBash1 = 'call_' + crypto.randomUUID().slice(0, 8);
  return [
    { type: 'agent_start' },
    {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    },
    {
      type: 'tool_execution_start',
      toolCallId: callEdit1,
      toolName: 'edit',
      args: { file_path: 'test.ts' },
    },
    {
      type: 'tool_execution_start',
      toolCallId: callBash1,
      toolName: 'bash',
      args: { command: 'ls' },
    },
    {
      type: 'message_update',
      message: { role: 'assistant' },
      assistantMessageEvent: {
        type: 'tool_use_delta',
        toolCallId: callEdit1,
      },
    },
    {
      type: 'tool_execution_end',
      toolCallId: callEdit1,
      toolName: 'edit',
      result: {
        content: [],
        details: { diff: '+added\n-removed' },
      },
      isError: false,
    },
    {
      type: 'tool_execution_end',
      toolCallId: callBash1,
      toolName: 'bash',
      result: {
        content: [],
        exit_code: 0,
      },
      isError: false,
    },
    { type: 'agent_end', messages: [] },
  ];
}

function makeOutOfOrderEventSequence(): object[] {
  return [
    { type: 'agent_start' },
    {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    },
    // tool_execution_end for call_orphan_1 arrives BEFORE its matching start
    {
      type: 'tool_execution_end',
      toolCallId: 'call_orphan_1',
      toolName: 'bash',
      result: {
        content: [],
        exit_code: 0,
      },
      isError: false,
    },
    // tool_execution_start for call_orphan_1 arrives LATER
    {
      type: 'tool_execution_start',
      toolCallId: 'call_orphan_1',
      toolName: 'bash',
      args: { command: 'echo hello' },
    },
    { type: 'agent_end', messages: [] },
  ];
}

function makeMultiToolSequence(): object[] {
  return [
    { type: 'agent_start' },
    {
      type: 'tool_execution_start',
      toolCallId: 'call_t1',
      toolName: 'edit',
      args: { file_path: 'a.ts' },
    },
    {
      type: 'tool_execution_start',
      toolCallId: 'call_t2',
      toolName: 'read',
      args: { file_path: 'b.ts' },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'call_t1',
      toolName: 'edit',
      result: { content: [], details: { diff: 'changed' } },
      isError: false,
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'call_t2',
      toolName: 'read',
      result: { content: [{ text: 'file content' }] },
      isError: false,
    },
    { type: 'agent_end', messages: [] },
  ];
}

// ---------------------------------------------------------------------------
// Garbage generation
// ---------------------------------------------------------------------------
function randomGarbage(): string[] {
  const lines: string[] = [];
  const count = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < count; i++) {
    if (Math.random() < 0.5) {
      lines.push(`not json at all ${Math.random()}`);
    } else {
      lines.push(`${Math.random()}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Response construction
// ---------------------------------------------------------------------------
function makeResponse(id: string | undefined, command: string): object {
  const defaultData: Record<string, unknown> = { ok: true };

  if (command === 'get_state') {
    defaultData.thinkingLevel = 'medium';
    defaultData.isStreaming = false;
    defaultData.isCompacting = false;
  } else if (command === 'get_messages') {
    defaultData.messages = [];
  } else if (command === 'get_available_models') {
    defaultData.models = [
      {
        id: 'claude-sonnet-5',
        provider: 'anthropic',
        label: 'Claude Sonnet 5',
      },
    ];
  } else if (command === 'new_session') {
    defaultData.cancelled = false;
  } else if (command === 'cycle_model') {
    defaultData.model = {
      id: 'claude-opus-5',
      provider: 'anthropic',
      label: 'Claude Opus 5',
    };
    defaultData.thinkingLevel = 'medium';
    defaultData.isScoped = false;
  }

  return {
    id,
    type: 'response',
    command,
    success: true,
    data: defaultData,
  };
}

function makeErrorResponse(id: string | undefined, command: string, message: string): object {
  return {
    id,
    type: 'response',
    command,
    success: false,
    errorMessage: message,
  };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const scenario = (process.env.MOCK_SCENARIO ?? 'echo').trim().toLowerCase();
let firstCommand = true;

// multi-session state
const sessionStates = new Map<string, object>();
let currentSessionId = 'default';

import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // Non-JSON line — silently ignore (mirrors real pi stderr behaviour)
    writeLine(`{"type":"__ignored__","raw":"${trimmed.replace(/"/g, '\\"')}"}`);
    return;
  }

  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const type = typeof obj.type === 'string' ? obj.type : '';

  // Handle special control commands
  if (type === '__crash__') {
    process.exit(1);
  }
  if (type === '__end__') {
    process.exit(0);
  }
  if (type === '__session__' && scenario === 'multi-session') {
    const sessionId = String(obj.value ?? 'default');
    currentSessionId = sessionId;
    if (!sessionStates.has(sessionId)) {
      sessionStates.set(sessionId, { messages: [], model: null });
    }
    writeLine(JSON.stringify({ id, type: 'response', command: '__session__', success: true }));
    return;
  }
  if (type.startsWith('__')) {
    // Unknown control command — respond with ack
    writeLine(JSON.stringify({ id, type: 'response', command: type, success: true }));
    return;
  }

  // env-echo scenario: respond with env vars regardless of command type
  if (scenario === 'env-echo') {
    const pathVal = process.env.PATH ?? '';
    const resp = makeResponse(id, type);
    (resp as any).data = {
      env: {
        PATH: pathVal.length > 200 ? pathVal.slice(0, 200) : pathVal,
        HOME: process.env.HOME ?? '',
        MY_CUSTOM_VAR: process.env.MY_CUSTOM_VAR ?? null,
        CUSTOM_LIST: process.env.CUSTOM_LIST ?? null,
        inherited: true,
      },
    };
    writeLine(JSON.stringify(resp));
    return;
  }

  // Scenario-specific behaviour
  switch (scenario) {
    case 'crash':
      if (firstCommand) {
        firstCommand = false;
        const resp = makeResponse(id, type);
        writeLine(JSON.stringify(resp));
        setTimeout(() => process.exit(1), 50);
        return;
      }
      break;

    case 'slow':
      setTimeout(() => {
        writeLine(JSON.stringify(makeResponse(id, type)));
      }, 5000);
      return;

    case 'endless':
      // Never respond — simulate hang
      return;

    case 'events':
      // First emit events, then respond
      if (type === 'prompt' || type === 'steer' || type === 'follow_up') {
        const events = makeEventSequence();
        for (const ev of events) {
          writeLine(JSON.stringify(ev));
        }
        setTimeout(() => {
          writeLine(JSON.stringify(makeResponse(id, type)));
        }, 50);
        return;
      }
      break;

    case 'dual-tools':
      if (type === 'prompt') {
        const events = makeMultiToolSequence();
        for (const ev of events) {
          writeLine(JSON.stringify(ev));
        }
        setTimeout(() => {
          writeLine(JSON.stringify(makeResponse(id, type)));
        }, 50);
        return;
      }
      break;

    case 'out-of-order':
      if (type === 'prompt') {
        const events = makeOutOfOrderEventSequence();
        for (const ev of events) {
          writeLine(JSON.stringify(ev));
        }
        setTimeout(() => {
          writeLine(JSON.stringify(makeResponse(id, type)));
        }, 50);
        return;
      }
      break;

    case 'chunks':
      if (type === 'prompt') {
        const resp = JSON.stringify(makeResponse(id, type));
        const len = resp.length;
        const part1 = resp.slice(0, Math.floor(len * 0.4));
        const part2 = resp.slice(Math.floor(len * 0.4), Math.floor(len * 0.7));
        const part3 = resp.slice(Math.floor(len * 0.7));
        writeOutput(part1);
        setTimeout(() => {
          writeOutput(part2);
          setTimeout(() => {
            writeLine(part3); // final write with \n
          }, 50);
        }, 50);
        return;
      }
      break;

    case 'banner':
      writeLine('=== Pi REPL v0.1.0 ===');
      writeLine('Type /help for commands');
      writeLine(JSON.stringify(makeResponse(id, type)));
      return;

    case 'multi-session':
      if (type === 'get_state') {
        const state = sessionStates.get(currentSessionId) ?? {};
        const resp = {
          id,
          type: 'response',
          command: 'get_state',
          success: true,
          data: {
            ...state,
            sessionId: currentSessionId,
          },
        };
        writeLine(JSON.stringify(resp));
        return;
      }
      // For other commands, respond with a session-scoped ack
      writeLine(JSON.stringify(makeResponse(id, type)));
      return;

    case 'u2028-test':
      {
        const data = {
          text: 'Line Separator Paragraph',
          summary: 'Contains U+2028 and U+2029',
        };
        const resp = { id, type: 'response', command: type, success: true, data };
        writeLine(JSON.stringify(resp));
        return;
      }

    default:
      // "echo" — respond immediately
      break;
  }

  writeLine(JSON.stringify(makeResponse(id, type)));
});

rl.on('close', () => {
  // stdin closed — exit cleanly
  process.exit(0);
});

// Handle SIGTERM from parent
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

function writeLine(text: string): void {
  process.stdout.write(text + '\n');
}

function writeOutput(text: string): void {
  process.stdout.write(text); // no trailing \n
}
