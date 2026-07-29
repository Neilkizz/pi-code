import assert from 'assert';
import {
  appReducer,
  initialState,
  type AppState,
  type AppAction,
  reduceMessages,
  convertAgentMessages,
} from '../../src/ui/AppState';
import type {
  PiEvent,
  AgentMessage,
  MessageStartEvent,
  MessageUpdateEvent,
  MessageEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
  CompactionStartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
} from '../../src/rpc/types';

describe('appReducer', () => {
  it('initial state is correct', () => {
    const state = initialState;
    assert.strictEqual(state.activeSessionId, null);
    assert.deepStrictEqual(state.messages, []);
    assert.strictEqual(state.isStreaming, false);
    assert.strictEqual(state.model, '');
    assert.strictEqual(state.thinking, 'medium');
    assert.deepStrictEqual(state.suggestions, []);
    assert.deepStrictEqual(state.contextItems, []);
    assert.strictEqual(state.gitBranch, '');
    assert.strictEqual(state.gitChanges, '');
    assert.strictEqual(state.changeSummary, '');
    assert.strictEqual(state.sessionName, '');
    assert.deepStrictEqual(state.sessions, []);
  });

  it('piEvent delegates to reduceMessages', () => {
    const event: PiEvent = {
      type: 'message_start',
      message: { role: 'user', content: 'hello' },
    } as MessageStartEvent;
    const action: AppAction = { kind: 'piEvent', sessionId: 's1', event };
    const state = appReducer({ ...initialState, activeSessionId: 's1' }, action);
    assert.strictEqual(state.messages.length, 1);
    assert.strictEqual(state.messages[0].kind, 'user');
    assert.strictEqual(state.messages[0].text, 'hello');
  });

  it('piEvent with different sessionId returns state unchanged', () => {
    const event: PiEvent = {
      type: 'message_start',
      message: { role: 'user', content: 'hello' },
    } as MessageStartEvent;
    const action: AppAction = { kind: 'piEvent', sessionId: 's2', event };
    const state = appReducer({ ...initialState, activeSessionId: 's1' }, action);
    assert.deepStrictEqual(state.messages, []);
  });

  it('stateSnapshot updates model, thinking, isStreaming', () => {
    const action: AppAction = {
      kind: 'stateSnapshot',
      sessionId: 's1',
      model: 'anthropic/claude-3',
      thinkingLevel: 'high',
      isStreaming: true,
      sessionName: 'Test Session',
      messageCount: 5,
    };
    const state = appReducer(initialState, action);
    assert.strictEqual(state.activeSessionId, 's1');
    assert.strictEqual(state.model, 'anthropic/claude-3');
    assert.strictEqual(state.thinking, 'high');
    assert.strictEqual(state.isStreaming, true);
    assert.strictEqual(state.sessionName, 'Test Session');
  });

  it('stateSnapshot with new sessionId resets messages', () => {
    const prevState: AppState = {
      ...initialState,
      activeSessionId: 's1',
      messages: [{ id: '1', kind: 'user', text: 'old' }],
    };
    const action: AppAction = {
      kind: 'stateSnapshot',
      sessionId: 's2',
      model: 'anthropic/claude-3',
      thinkingLevel: 'high',
      isStreaming: true,
      sessionName: 'New Session',
      messageCount: 0,
    };
    const state = appReducer(prevState, action);
    assert.strictEqual(state.activeSessionId, 's2');
    assert.deepStrictEqual(state.messages, []);
    assert.strictEqual(state.sessionName, 'New Session');
  });

  it('stateSnapshot with same sessionId keeps messages', () => {
    const prevState: AppState = {
      ...initialState,
      activeSessionId: 's1',
      messages: [{ id: '1', kind: 'user', text: 'keep' }],
    };
    const action: AppAction = {
      kind: 'stateSnapshot',
      sessionId: 's1',
      model: 'anthropic/claude-3',
      thinkingLevel: 'high',
      isStreaming: true,
      sessionName: 'Test Session',
      messageCount: 5,
    };
    const state = appReducer(prevState, action);
    assert.strictEqual(state.activeSessionId, 's1');
    assert.strictEqual(state.messages.length, 1);
    assert.strictEqual(state.messages[0].text, 'keep');
  });

  it('history sets messages via convertAgentMessages', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hello' } as any,
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] } as any,
    ];
    const action: AppAction = { kind: 'history', sessionId: 's1', messages };
    const state = appReducer({ ...initialState, activeSessionId: 's1' }, action);
    assert.strictEqual(state.messages.length, 2);
    assert.strictEqual(state.messages[0].kind, 'user');
    assert.strictEqual(state.messages[0].text, 'hello');
    assert.strictEqual(state.messages[1].kind, 'assistant');
    assert.strictEqual(state.messages[1].text, 'hi there');
  });

  it('history with different sessionId returns state unchanged', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: 'hello' } as any];
    const action: AppAction = { kind: 'history', sessionId: 's2', messages };
    const state = appReducer({ ...initialState, activeSessionId: 's1' }, action);
    assert.deepStrictEqual(state.messages, []);
  });

  it('selectSession changes sessionId and clears messages', () => {
    const prevState: AppState = {
      ...initialState,
      activeSessionId: 's1',
      messages: [{ id: '1', kind: 'user', text: 'old' }],
    };
    const action: AppAction = { kind: 'selectSession', sessionId: 's2' };
    const state = appReducer(prevState, action);
    assert.strictEqual(state.activeSessionId, 's2');
    assert.deepStrictEqual(state.messages, []);
  });

  it('fileSuggestions updates suggestions array', () => {
    const action: AppAction = { kind: 'fileSuggestions', files: ['file1.ts', 'file2.ts'] };
    const state = appReducer(initialState, action);
    assert.deepStrictEqual(state.suggestions, ['file1.ts', 'file2.ts']);
  });

  it('modelList updates suggestions with provider/model format', () => {
    const action: AppAction = {
      kind: 'modelList',
      models: [
        { provider: 'anthropic', id: 'claude-3' },
        { provider: 'openai', id: 'gpt-4' },
      ],
    };
    const state = appReducer(initialState, action);
    assert.deepStrictEqual(state.suggestions, ['anthropic/claude-3', 'openai/gpt-4']);
  });

  it('contextUpdate updates contextItems from labels', () => {
    const action: AppAction = {
      kind: 'contextUpdate',
      items: [{ label: 'file1.ts' }, { label: 'file2.ts' }],
    };
    const state = appReducer(initialState, action);
    assert.deepStrictEqual(state.contextItems, ['file1.ts', 'file2.ts']);
  });

  it('gitStatus updates branch and changes string', () => {
    const action: AppAction = {
      kind: 'gitStatus',
      branch: 'main',
      added: 5,
      deleted: 2,
      modified: 3,
    };
    const state = appReducer(initialState, action);
    assert.strictEqual(state.gitBranch, 'main');
    assert.strictEqual(state.gitChanges, '+5/-2 ~3');
  });

  it('changeSummary updates summary string', () => {
    const action: AppAction = { kind: 'changeSummary', summary: 'Modified 3 files' };
    const state = appReducer(initialState, action);
    assert.strictEqual(state.changeSummary, 'Modified 3 files');
  });

  it('action with nonexistent kind returns state unchanged', () => {
    // The `as any` cast simulates a runtime path TypeScript normally prevents;
    // ensures the default branch handles unexpected kind values gracefully.
    const action = { kind: 'nonexistent' } as any;
    const state = appReducer(initialState, action);
    assert.deepStrictEqual(state, initialState);
  });

  it('multiple actions compose correctly', () => {
    let state = initialState;

    // Select session
    state = appReducer(state, { kind: 'selectSession', sessionId: 's1' });
    assert.strictEqual(state.activeSessionId, 's1');
    assert.deepStrictEqual(state.messages, []);

    // State snapshot
    state = appReducer(state, {
      kind: 'stateSnapshot',
      sessionId: 's1',
      model: 'anthropic/claude-3',
      thinkingLevel: 'high',
      isStreaming: false,
      sessionName: 'Test',
      messageCount: 0,
    });
    assert.strictEqual(state.model, 'anthropic/claude-3');

    // Add piEvent (user message)
    const userEvent: PiEvent = {
      type: 'message_start',
      message: { role: 'user', content: 'Hello' },
    } as MessageStartEvent;
    state = appReducer(state, { kind: 'piEvent', sessionId: 's1', event: userEvent });
    assert.strictEqual(state.messages.length, 1);
    assert.strictEqual(state.messages[0].kind, 'user');
    assert.strictEqual(state.messages[0].text, 'Hello');

    // Add piEvent (assistant streaming)
    const assistantEvent: PiEvent = {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    } as MessageStartEvent;
    state = appReducer(state, { kind: 'piEvent', sessionId: 's1', event: assistantEvent });
    assert.strictEqual(state.messages.length, 2);
    assert.strictEqual(state.messages[1].kind, 'assistant');
    assert.strictEqual(state.messages[1].isStreaming, true);

    // text_delta
    const textDelta: PiEvent = {
      type: 'message_update',
      message: state.messages[1].message!,
      assistantMessageEvent: { type: 'text_delta', delta: ' world' },
    } as MessageUpdateEvent;
    state = appReducer(state, { kind: 'piEvent', sessionId: 's1', event: textDelta });
    assert.strictEqual(state.messages[1].text, ' world');

    // message_end
    const messageEnd: PiEvent = {
      type: 'message_end',
      message: state.messages[1].message!,
    } as MessageEndEvent;
    state = appReducer(state, { kind: 'piEvent', sessionId: 's1', event: messageEnd });
    assert.strictEqual(state.messages[1].isStreaming, false);

    // fileSuggestions
    state = appReducer(state, { kind: 'fileSuggestions', files: ['src/foo.ts'] });
    assert.deepStrictEqual(state.suggestions, ['src/foo.ts']);

    // gitStatus
    state = appReducer(state, {
      kind: 'gitStatus',
      branch: 'main',
      added: 1,
      deleted: 0,
      modified: 2,
    });
    assert.strictEqual(state.gitBranch, 'main');
    assert.strictEqual(state.gitChanges, '+1/-0 ~2');
  });
});
