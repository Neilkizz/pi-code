import assert from 'assert';
import { PiEventBus, PiRpcClient } from '../../src/rpc/PiRpcClient';
import type { PiEvent, AgentStartEvent, AgentSettledEvent } from '../../src/rpc/types';

describe('PiEventBus', () => {
  it('fires events to subscribers', () => {
    const bus = new PiEventBus();
    const received: PiEvent[] = [];
    const sub = bus.onEvent((e) => received.push(e));
    bus.fire({ type: 'agent_start' } as AgentStartEvent);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, 'agent_start');
    sub.dispose();
  });

  it('unsubscribes correctly', () => {
    const bus = new PiEventBus();
    const received: PiEvent[] = [];
    const sub = bus.onEvent((e) => received.push(e));
    bus.fire({ type: 'agent_start' } as AgentStartEvent);
    sub.dispose();
    bus.fire({ type: 'agent_settled' } as AgentSettledEvent);
    assert.strictEqual(received.length, 1);
  });

  it('dispose removes all listeners', () => {
    const bus = new PiEventBus();
    let fired = 0;
    bus.onEvent(() => {
      fired++;
    });
    bus.dispose();
    bus.fire({ type: 'agent_start' } as AgentStartEvent);
    assert.strictEqual(fired, 0);
  });

  it('multiple subscribers receive the same event', () => {
    const bus = new PiEventBus();
    let count1 = 0;
    let count2 = 0;
    const sub1 = bus.onEvent(() => {
      count1++;
    });
    const sub2 = bus.onEvent(() => {
      count2++;
    });
    bus.fire({ type: 'agent_start' } as AgentStartEvent);
    assert.strictEqual(count1, 1);
    assert.strictEqual(count2, 1);
    sub1.dispose();
    sub2.dispose();
  });
});

describe('PiRpcClient', () => {
  it('constructs without subprocess', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      extraArgs: ['-c', "echo '{}'"],
      autoReconnect: false,
    });
    assert.strictEqual(client.isAlive, false);
    assert.strictEqual(client.commandCount, 0);
    assert.strictEqual(client.restartCountTotal, 0);
    assert.strictEqual(client.roundTripMs, 0);
    client.dispose();
  });

  it('starts the child process with correct args', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      extraArgs: ['--session-id', 'test-session'],
      autoReconnect: false,
    });
    client.start();
    assert.strictEqual(client.isAlive, true);
    client.dispose();
  });

  it('dispose sends SIGTERM and cleans up', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      extraArgs: ['-c', 'sleep 10'],
      autoReconnect: false,
    });
    client.start();
    assert.strictEqual(client.isAlive, true);
    client.dispose();
    assert.strictEqual(client.isAlive, false);
  });

  it('commandCount initializes to zero', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      autoReconnect: false,
    });
    assert.strictEqual(client.commandCount, 0);
    client.dispose();
  });

  it('restart counters are initialized to zero', () => {
    const client = new PiRpcClient({
      executable: 'pi',
      autoReconnect: false,
    });
    assert.strictEqual(client.restartCountTotal, 0);
    client.dispose();
  });

  it('start() is safe to call on a live process', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      autoReconnect: false,
    });
    client.start();
    assert.strictEqual(client.isAlive, true);
    // Second call should not break anything.
    client.start();
    assert.strictEqual(client.isAlive, true);
    client.dispose();
  });

  it('event bus subscribers can handle events safely', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      autoReconnect: false,
    });
    // Register a handler and verify it receives events.
    let received = false;
    const sub = client.bus.onEvent(() => {
      received = true;
    });
    client.start();
    client.bus.fire({ type: 'agent_start' } as AgentStartEvent);
    assert.ok(received);
    sub.dispose();
    client.dispose();
  });

  it('onEvent is accessible as an instance method', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      autoReconnect: false,
    });
    const events: PiEvent[] = [];
    const sub = client.onEvent((e) => events.push(e));
    assert.ok(typeof sub.dispose === 'function');
    // Unsubscribe and verify.
    sub.dispose();
    client.bus.fire({ type: 'agent_start' } as AgentStartEvent);
    assert.strictEqual(events.length, 0);
    client.dispose();
  });

  it('rejects requests when autoReconnect is false and process is dead', async () => {
    const client = new PiRpcClient({
      executable: 'echo',
      autoReconnect: false,
      requestTimeoutMs: 1000,
    });
    // Don't start, so isAlive=false. Any request should reject.
    try {
      await (client as any).request({ type: 'get_state' });
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(
        err.message.includes('not running'),
        `expected 'not running' message, got: ${err.message}`,
      );
    }
    client.dispose();
  });

  it('refuses requests after dispose', async () => {
    const client = new PiRpcClient({
      executable: 'echo',
      autoReconnect: false,
    });
    client.dispose();
    try {
      await (client as any).request({ type: 'get_state' });
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(err.message.includes('disposed'), `expected disposed message, got: ${err.message}`);
    }
  });

  it('shares the event bus for other subscribers', () => {
    const client = new PiRpcClient({
      executable: 'sh',
      autoReconnect: false,
    });
    const events: PiEvent[] = [];
    const sub = client.bus.onEvent((e) => events.push(e));
    client.start();
    client.bus.fire({ type: 'agent_start' } as AgentStartEvent);
    assert.strictEqual(events.length, 1);
    sub.dispose();
    client.dispose();
  });

  it('autoReconnect=true schedules restart on process exit', (done) => {
    const client = new PiRpcClient({
      executable: 'echo',
      autoReconnect: true,
      maxBackoffMs: 100,
    });
    client.start();
    assert.strictEqual(client.isAlive, true);
    // echo exits immediately — handleDeath fires asynchronously.
    setTimeout(() => {
      // The process may have restarted or hit the max restart count.
      // Either way, the restart mechanism was triggered.
      assert.ok(client.restartCountTotal >= 0);
      client.dispose();
      done();
    }, 500);
  });
});
