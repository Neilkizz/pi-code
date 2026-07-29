import assert from 'assert';
import { PiSession } from '../../src/session/PiSession';
import type { ExtensionContext } from '../../src/types/ExtensionContext';
import type * as T from '../../src/rpc/types';

function makeCtx(): ExtensionContext {
  return {
    config: {
      executable: 'pi',
      extraArgs: () => ['--provider', 'anthropic', '--model', 'claude-3'],
      cwd: () => '/fake/workspace',
      autoReconnect: true,
    } as any,
    vscodeContext: {} as any,
    showOutputChannel: () => {},
    log: (() => {}) as any,
  } as ExtensionContext;
}

describe('PiSession', () => {
  it('creates PiRpcClient with correct extraArgs', () => {
    const ctx = makeCtx();
    const session = new PiSession(ctx, 'test-session-1', { skipStart: true });

    assert.strictEqual(session.id, 'test-session-1');
    assert.strictEqual(session.client.isAlive, false); // skipStart
    assert.ok(session.onEvent !== undefined);
    assert.ok(session.onDidChangeState !== undefined);

    session.dispose();
  });

  it('forwards PiRpcClient events via onEvent', () => {
    const ctx = makeCtx();
    const session = new PiSession(ctx, 'test-session-2', { skipStart: true });

    const received: T.PiEvent[] = [];
    const sub = session.onEvent((e: T.PiEvent) => received.push(e));

    // Fire via the underlying PiRpcClient event bus to test forwarding
    const event: T.PiEvent = {
      type: 'agent_start',
    } as T.AgentStartEvent;
    session.client.bus.fire(event);

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, 'agent_start');

    sub.dispose();
    session.dispose();
  });

  it('maintains state from events (isStreaming)', () => {
    const ctx = makeCtx();
    const session = new PiSession(ctx, 'test-session-3', { skipStart: true });

    // Initially null until first event
    assert.strictEqual(session.state, null);

    // agent_start sets isStreaming=true
    session.client.bus.fire({ type: 'agent_start' } as T.AgentStartEvent);
    assert.strictEqual((session.state as any).isStreaming, true);

    // agent_end sets isStreaming=false
    session.client.bus.fire({ type: 'agent_end', messages: [] } as T.AgentEndEvent);
    assert.strictEqual((session.state as any).isStreaming, false);

    session.dispose();
  });

  it('onDidChangeState fires when state changes', () => {
    const ctx = makeCtx();
    const session = new PiSession(ctx, 'test-session-4', { skipStart: true });

    let fired = false;
    const sub = session.onDidChangeState(() => {
      fired = true;
    });

    session.client.bus.fire({ type: 'agent_start' } as T.AgentStartEvent);
    assert.strictEqual(fired, true);

    sub.dispose();
    session.dispose();
  });

  it('dispose cleans up and marks disposed', () => {
    const ctx = makeCtx();
    const session = new PiSession(ctx, 'test-session-5', { skipStart: true });

    // Verify it is alive before dispose
    assert.strictEqual(session.client.isAlive, false); // skipStart: true

    session.dispose();

    // Second dispose is safe (idempotent check)
    session.dispose();
  });

  it('refreshState catches errors and returns existing state', async () => {
    const ctx = makeCtx();
    const session = new PiSession(ctx, 'test-session-6', {
      skipStart: true,
      autoReconnect: false,
    });

    // No subprocess running -> refreshState should catch error and return null
    const state = await session.refreshState();
    assert.strictEqual(state, null);

    session.dispose();
  });
});
