import assert from 'assert';
import {
  reduceMessages,
  convertAgentMessages,
  textFromMsg,
  textFromResult,
  type DisplayMessage,
} from '../../src/ui/AppState';

import type {
  MessageStartEvent,
  MessageUpdateEvent,
  MessageEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
  CompactionStartEvent,
  ThinkingDeltaEvent,
  TextDeltaEvent,
  UserMessage,
  AssistantMessage,
} from '../../src/rpc/types';

describe('reduceMessages', () => {
  it('starts user message', () => {
    const msgs = reduceMessages([], {
      type: 'message_start',
      message: { role: 'user', content: 'hello' } as any,
    } as MessageStartEvent);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].kind, 'user');
    assert.strictEqual(msgs[0].text, 'hello');
  });

  it('starts assistant message as streaming', () => {
    const msgs = reduceMessages([], {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    } as MessageStartEvent);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].kind, 'assistant');
    assert.strictEqual(msgs[0].isStreaming, true);
    assert.strictEqual(msgs[0].text, '');
  });

  it('builds both user and assistant from message_start', () => {
    const msgs = reduceMessages([], {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    } as MessageStartEvent);
    assert.strictEqual(msgs[0].kind, 'assistant');
  });

  it('text_delta appends to last streaming message', () => {
    const prev: DisplayMessage[] = [{ id: '1', kind: 'assistant', text: '', isStreaming: true }];
    const e: MessageUpdateEvent = {
      type: 'message_update',
      message: prev[0].message!,
      assistantMessageEvent: {
        type: 'text_delta',
        delta: 'Hello',
      } as TextDeltaEvent,
    };
    const msgs = reduceMessages(prev, e);
    assert.strictEqual(msgs[0].text, 'Hello');
  });

  it('thinking_delta goes to thinkingText, not text', () => {
    const prev: DisplayMessage[] = [{ id: '1', kind: 'assistant', text: '', isStreaming: true }];
    const ev: MessageUpdateEvent = {
      type: 'message_update',
      message: prev[0],
      assistantMessageEvent: {
        type: 'thinking_delta',
        delta: 'reasoning...',
      } as ThinkingDeltaEvent,
    } as any;
    const msgs = reduceMessages(prev, ev);
    assert.strictEqual(msgs[0].text, '');
    assert.strictEqual(msgs[0].thinkingText, 'reasoning...');
  });

  it('message_end stops streaming', () => {
    const prev: DisplayMessage[] = [
      { id: '1', kind: 'assistant', text: 'done', isStreaming: true },
    ];
    const msgs = reduceMessages(prev, {
      type: 'message_end',
      message: {} as any,
    } as MessageEndEvent);
    assert.strictEqual(msgs[0].isStreaming, false);
  });

  it('tool_execution_start sets running state', () => {
    const msgs = reduceMessages([], {
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'bash',
      args: { command: 'ls' },
    } as ToolExecutionStartEvent);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].kind, 'tool');
    assert.strictEqual(msgs[0].toolCallId, 't1');
    assert.strictEqual(msgs[0].toolStatus, 'running');
  });

  it('tool_execution_update mirrors partial result', () => {
    const prev: DisplayMessage[] = [
      {
        id: 't1',
        kind: 'tool',
        toolCallId: 't1',
        toolName: 'bash',
        toolStatus: 'running',
        text: '',
      },
    ];
    const msgs = reduceMessages(prev, {
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'bash',
      partialResult: { content: [{ text: 'line1\n' }] },
    } as ToolExecutionUpdateEvent);
    assert.strictEqual(msgs[0].text, 'line1\n');
    assert.strictEqual(msgs[0].isStreaming, true);
  });

  it('tool_execution_end matches by toolCallId precisely', () => {
    const prev: DisplayMessage[] = [
      {
        id: 't1',
        kind: 'tool',
        toolCallId: 't1',
        toolName: 'edit',
        toolStatus: 'running',
        text: '',
      },
      {
        id: 't2',
        kind: 'tool',
        toolCallId: 't2',
        toolName: 'edit',
        toolStatus: 'running',
        text: '',
      },
    ];
    const msgs = reduceMessages(prev, {
      type: 'tool_execution_end',
      toolCallId: 't2',
      toolName: 'edit',
      result: { content: [{ text: 'patch' }] },
      isError: false,
    } as ToolExecutionEndEvent);
    // t1 should still be running; t2 should be done.
    assert.strictEqual(msgs[0].toolStatus, 'running');
    assert.strictEqual(msgs[1].toolStatus, 'done');
    assert.strictEqual(msgs[1].kind, 'tool-end');
  });

  it('tool_execution_end that is error sets state', () => {
    const prev: DisplayMessage[] = [
      {
        id: 't1',
        kind: 'tool',
        toolCallId: 't1',
        toolName: 'bash',
        toolStatus: 'running',
        text: '',
      },
    ];
    const msgs = reduceMessages(prev, {
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'bash',
      result: { content: [] },
      isError: true,
    } as ToolExecutionEndEvent);
    assert.strictEqual(msgs[0].toolStatus, 'error');
  });

  it('compaction events add banners', () => {
    const msgs = reduceMessages([], {
      type: 'compaction_start',
      reason: 'manual',
    } as CompactionStartEvent);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].kind, 'compaction');
    assert.strictEqual(msgs[0].text, 'Context compacting…');
  });

  it('trims to last 200 messages', () => {
    const prev: DisplayMessage[] = [];
    for (let i = 0; i < 250; i++) {
      prev.push({
        id: `t${i}`,
        kind: 'tool',
        toolCallId: `t${i}`,
        toolName: 'foo',
        toolStatus: 'running',
        text: '',
      });
    }
    const msgs = reduceMessages(prev, {
      type: 'compaction_start',
      reason: 'manual',
    } as CompactionStartEvent);
    assert.ok(msgs.length <= 201, `expected <=201, got ${msgs.length}`);
    assert.ok(msgs.length > 195, `expected >195, got ${msgs.length}`);
  });

  it('ignores unknown event types without crashing', () => {
    const msgs = reduceMessages([], { type: 'unknown_event' } as any);
    assert.strictEqual(msgs.length, 0);
  });

  it('accumulates multiple text deltas', () => {
    const prev: DisplayMessage[] = [
      { id: '1', kind: 'assistant', text: 'Hello', isStreaming: true },
    ];
    const e1: MessageUpdateEvent = {
      type: 'message_update',
      message: prev[0],
      assistantMessageEvent: {
        type: 'text_delta',
        delta: ' world',
      } as TextDeltaEvent,
    } as any;
    const after1 = reduceMessages(prev, e1);
    const e2: MessageUpdateEvent = {
      type: 'message_update',
      message: prev[0],
      assistantMessageEvent: {
        type: 'text_delta',
        delta: '!',
      } as TextDeltaEvent,
    } as any;
    const after2 = reduceMessages(after1, e2);
    assert.strictEqual(after2[0].text, 'Hello world!');
  });

  it('message_end on non-streaming message is a no-op', () => {
    const prev: DisplayMessage[] = [
      { id: '1', kind: 'assistant', text: 'done', isStreaming: false },
    ];
    const msgs = reduceMessages(prev, {
      type: 'message_end',
      message: {} as any,
    } as MessageEndEvent);
    // Nothing should change — no streaming message to stop.
    assert.strictEqual(msgs[0].isStreaming, false);
    assert.strictEqual(msgs[0].text, 'done');
  });

  it('tool_execution_update without matching running tool is a no-op', () => {
    const prev: DisplayMessage[] = [
      {
        id: 't2',
        kind: 'tool',
        toolCallId: 't2',
        toolName: 'bash',
        toolStatus: 'done',
        text: '',
      },
    ];
    const msgs = reduceMessages(prev, {
      type: 'tool_execution_update',
      toolCallId: 't1', // different from t2
      toolName: 'bash',
      partialResult: { content: [{ text: 'line1\n' }] },
    } as ToolExecutionUpdateEvent);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].toolCallId, 't2'); // unchanged
  });

  it('compaction_end adds a banner', () => {
    const msgs = reduceMessages([], {
      type: 'compaction_end',
      reason: 'threshold',
      result: {},
      aborted: false,
      willRetry: false,
    } as any);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].kind, 'compaction');
    assert.strictEqual(msgs[0].text, 'Context compacted');
  });

  it('message_update without has alstreaming last message is a no-op', () => {
    const msgs = reduceMessages([], {
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: {
        type: 'text_delta',
        delta: 'should not appear',
      } as TextDeltaEvent,
    } as MessageUpdateEvent);
    assert.strictEqual(msgs.length, 0);
  });

  it('starting auxiliary dms after dispatch', () => {
    const prev: DisplayMessage[] = [{ id: 'msg-user-0', kind: 'user', text: 'hello user' }];
    // Now start assistant
    const msgs = reduceMessages(prev, {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    } as MessageStartEvent);
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].kind, 'user');
    assert.strictEqual(msgs[1].kind, 'assistant');
    assert.strictEqual(msgs[1].isStreaming, true);
  });
});

describe('convertAgentMessages', () => {
  it('converts user and assistant text messages', () => {
    const history = convertAgentMessages([
      { role: 'user', content: 'hello user' } as UserMessage,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello assistant' }],
      } as AssistantMessage,
    ]);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].kind, 'user');
    assert.strictEqual(history[0].text, 'hello user');
    assert.strictEqual(history[1].kind, 'assistant');
    assert.strictEqual(history[1].text, 'hello assistant');
  });

  it('converts assistant message with thinking block', () => {
    const history = convertAgentMessages([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'thinking...' },
          { type: 'text', text: 'finished' },
        ],
      } as AssistantMessage,
    ]);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].kind, 'assistant');
    assert.strictEqual(history[0].text, 'finished');
    assert.strictEqual(history[0].thinkingText, 'thinking...');
  });

  it('converts tool calls and associates tool results', () => {
    const history = convertAgentMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            toolCallId: 't1',
            name: 'bash',
            args: { command: 'pwd' },
          },
        ],
      } as AssistantMessage,
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'bash',
        content: [{ text: '/workspace' }],
        isError: false,
      } as any,
    ]);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].kind, 'tool-end');
    assert.strictEqual(history[0].toolCallId, 't1');
    assert.strictEqual(history[0].toolStatus, 'done');
    assert.strictEqual(history[0].text, '/workspace');
  });

  it('handles compactionSummary and branchSummary', () => {
    const history = convertAgentMessages([
      { role: 'compactionSummary' } as any,
      { role: 'branchSummary' } as any,
    ]);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].kind, 'compaction');
    assert.strictEqual(history[0].text, 'Context compacted');
    assert.strictEqual(history[1].kind, 'compaction');
    assert.strictEqual(history[1].text, 'Session branched');
  });

  it('handles empty message array', () => {
    const history = convertAgentMessages([]);
    assert.strictEqual(history.length, 0);
  });

  it('handles assistant message with only toolCall blocks', () => {
    const history = convertAgentMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            toolCallId: 't1',
            name: 'read',
            args: { file_path: 'foo.ts' },
          },
          {
            type: 'toolCall',
            toolCallId: 't2',
            name: 'grep',
            args: { pattern: 'bar' },
          },
        ],
      } as AssistantMessage,
    ]);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].kind, 'tool');
    assert.strictEqual(history[0].toolCallId, 't1');
    assert.strictEqual(history[1].kind, 'tool');
    assert.strictEqual(history[1].toolCallId, 't2');
  });

  it('toolResult without toolCall match creates standalone entry', () => {
    const history = convertAgentMessages([
      {
        role: 'toolResult',
        toolCallId: 't_missing',
        toolName: 'bash',
        content: [{ text: 'output' }],
        isError: false,
      } as any,
    ]);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].kind, 'tool-end');
    assert.strictEqual(history[0].toolCallId, 't_missing');
  });

  it('assistant with interleaved text and toolCall blocks renders correctly', () => {
    const history = convertAgentMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          {
            type: 'toolCall',
            toolCallId: 't1',
            name: 'read',
            args: { file_path: 'foo.ts' },
          },
          { type: 'text', text: 'Now let me check something.' },
          {
            type: 'toolCall',
            toolCallId: 't2',
            name: 'grep',
            args: { pattern: 'bar' },
          },
          { type: 'text', text: 'Final thoughts.' },
        ],
      } as AssistantMessage,
    ]);
    assert.strictEqual(history.length, 5);
    assert.strictEqual(history[0].kind, 'assistant');
    assert.strictEqual(history[0].text, 'Let me read the file.');
    assert.strictEqual(history[1].kind, 'tool');
    assert.strictEqual(history[1].toolCallId, 't1');
    assert.strictEqual(history[2].kind, 'assistant');
    assert.strictEqual(history[2].text, 'Now let me check something.');
    assert.strictEqual(history[3].kind, 'tool');
    assert.strictEqual(history[3].toolCallId, 't2');
    assert.strictEqual(history[4].kind, 'assistant');
    assert.strictEqual(history[4].text, 'Final thoughts.');
  });
});

describe('textFromMsg', () => {
  it('extracts text from string content', () => {
    const msg = { role: 'user', content: 'hello' } as any;
    assert.strictEqual(textFromMsg(msg), 'hello');
  });

  it('extracts text from array content', () => {
    const msg = {
      role: 'assistant',
      content: [{ text: 'hello ' }, { text: 'world' }],
    } as any;
    assert.strictEqual(textFromMsg(msg), 'hello \nworld');
  });

  it('returns empty string for unknown content shape', () => {
    const msg = { role: 'user', content: 42 } as any;
    assert.strictEqual(textFromMsg(msg), '');
  });
});

describe('textFromResult', () => {
  it('returns empty string for null/undefined', () => {
    assert.strictEqual(textFromResult(null), '');
    assert.strictEqual(textFromResult(undefined), '');
  });

  it('returns string directly', () => {
    assert.strictEqual(textFromResult('output'), 'output');
  });

  it('extracts text from content array', () => {
    const result = { content: [{ text: 'line1\n' }, { text: 'line2' }] };
    assert.strictEqual(textFromResult(result), 'line1\n\nline2');
  });

  it('stringifies non-string non-array results', () => {
    const result = { custom: { nested: 'value' } };
    const output = textFromResult(result);
    assert.ok(output.includes('custom'));
    assert.ok(output.includes('value'));
  });
});

describe('reduceMessages truncation', () => {
  it('truncates text over 50K chars', () => {
    const long = 'x'.repeat(60000);
    const msgs = reduceMessages([], {
      type: 'message_start',
      message: { role: 'user', content: long },
    } as MessageStartEvent);
    assert.ok(msgs[0].text.length <= 50000 + 30);
    assert.ok(msgs[0].text.endsWith('[...truncated at 50K chars]'));
  });

  it('truncates thinkingText over 50K chars', () => {
    const prev: DisplayMessage[] = [
      { id: '1', kind: 'assistant', text: '', thinkingText: '', isStreaming: true },
    ];
    const longThinking = 'y'.repeat(60000);
    const ev: MessageUpdateEvent = {
      type: 'message_update',
      message: prev[0].message,
      assistantMessageEvent: {
        type: 'thinking_delta',
        delta: longThinking,
      } as ThinkingDeltaEvent,
    } as any;
    const msgs = reduceMessages(prev, ev);
    assert.ok(msgs[0].thinkingText!.length <= 50000 + 30);
  });
});
