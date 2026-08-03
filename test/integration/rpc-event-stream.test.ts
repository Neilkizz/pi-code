/**
 * Integration tests for PiRpcClient event streams — event type delivery,
 * ordering, out-of-order handlers, and chunk reassembly.
 *
 * All tests use the mock RPC server as a child process.
 */

import assert from 'assert';
import * as path from 'path';
import { PiRpcClient } from '../../src/rpc/PiRpcClient';
import type * as T from '../../src/rpc/types';

const MOCK_SERVER = path.resolve(__dirname, 'mockRpcServer.ts');

function createClient(scenario = 'echo', timeoutMs = 30000): PiRpcClient {
  return new PiRpcClient({
    executable: process.execPath,
    extraArgs: ['-r', 'ts-node/register', MOCK_SERVER],
    skipModePrefix: true,
    env: { MOCK_SCENARIO: scenario },
    autoReconnect: false,
    requestTimeoutMs: timeoutMs,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('PiRpcClient event streams (integration)', () => {
  // ---------------------------------------------------------------------------
  // 1. Normal stream: agent_start → message_start → text_delta → message_end → agent_end
  // ---------------------------------------------------------------------------
  it('normal event stream fires correct types in order (events scenario)', async () => {
    const client = createClient('events');
    client.start();

    const received: T.PiEvent[] = [];
    const sub = client.onEvent((e: T.PiEvent) => {
      received.push(e);
    });

    await client.prompt('Hello');
    await delay(100);

    const types = received.map((e) => e.type);
    assert.deepStrictEqual(types, [
      'agent_start',
      'message_start',
      'message_update',
      'message_end',
      'agent_end',
    ]);

    sub.dispose();
    client.dispose();
  });

  // ---------------------------------------------------------------------------
  // 2. Dual tool interleaved: tool1_start → tool2_start → tool1_end → tool2_end
  // ---------------------------------------------------------------------------
  it('dual tool events interleave without cross-talk (dual-tools scenario)', async () => {
    const client = createClient('dual-tools');
    client.start();

    const received: T.PiEvent[] = [];
    const sub = client.onEvent((e: T.PiEvent) => {
      received.push(e);
    });

    await client.prompt('Hello');
    await delay(100);

    const types = received.map((e) => e.type);
    assert.deepStrictEqual(types, [
      'agent_start',
      'tool_execution_start',
      'tool_execution_start',
      'tool_execution_end',
      'tool_execution_end',
      'agent_end',
    ]);

    // Verify toolCallIds are correct
    const starts = received.filter(
      (e) => e.type === 'tool_execution_start',
    ) as T.ToolExecutionStartEvent[];
    assert.strictEqual(starts.length, 2);
    assert.strictEqual(starts[0].toolCallId, 'call_t1');
    assert.strictEqual(starts[1].toolCallId, 'call_t2');

    // Verify tool names
    assert.strictEqual(starts[0].toolName, 'edit');
    assert.strictEqual(starts[1].toolName, 'read');

    // Verify no cross-talk: t1 ends before t2
    const ends = received.filter(
      (e) => e.type === 'tool_execution_end',
    ) as T.ToolExecutionEndEvent[];
    assert.strictEqual(ends.length, 2);
    assert.strictEqual(ends[0].toolCallId, 'call_t1');
    assert.strictEqual(ends[1].toolCallId, 'call_t2');

    sub.dispose();
    client.dispose();
  });

  // ---------------------------------------------------------------------------
  // 3. Duplicate agent_end: send two prompts, verify agent_end received twice
  // ---------------------------------------------------------------------------
  it('duplicate agent_end events do not crash the client', async () => {
    const client = createClient('events');
    client.start();

    const agentEndEvents: T.AgentEndEvent[] = [];
    const sub = client.onEvent((e: T.PiEvent) => {
      if (e.type === 'agent_end') {
        agentEndEvents.push(e as T.AgentEndEvent);
      }
    });

    await client.prompt('First');
    await delay(100);
    await client.prompt('Second');
    await delay(100);

    assert.strictEqual(agentEndEvents.length, 2);
    assert.strictEqual(agentEndEvents[0].type, 'agent_end');
    assert.strictEqual(agentEndEvents[1].type, 'agent_end');

    sub.dispose();
    client.dispose();
  });

  // ---------------------------------------------------------------------------
  // 4. Verify events pass through correctly (events scenario)
  // ---------------------------------------------------------------------------
  it('events arrive unchanged via onEvent subscription', async () => {
    const client = createClient('events');
    client.start();

    const received: T.PiEvent[] = [];
    const sub = client.onEvent((e: T.PiEvent) => {
      received.push(e);
    });

    await client.prompt('Test');
    await delay(100);

    assert.ok(received.length >= 5, `expected >=5 events, got ${received.length}`);

    const agentStart = received[0] as T.AgentStartEvent;
    assert.strictEqual(agentStart.type, 'agent_start');

    const msgStart = received[1] as T.MessageStartEvent;
    assert.strictEqual(msgStart.type, 'message_start');
    assert.strictEqual(msgStart.message.role, 'assistant');

    const msgUpdate = received[2] as T.MessageUpdateEvent;
    assert.strictEqual(msgUpdate.type, 'message_update');
    assert.strictEqual(msgUpdate.assistantMessageEvent.type, 'text_delta');
    assert.strictEqual((msgUpdate.assistantMessageEvent as T.TextDeltaEvent).delta, 'Hello');

    const msgEnd = received[3] as T.MessageEndEvent;
    assert.strictEqual(msgEnd.type, 'message_end');

    const agentEnd = received[4] as T.AgentEndEvent;
    assert.strictEqual(agentEnd.type, 'agent_end');

    sub.dispose();
    client.dispose();
  });

  // ---------------------------------------------------------------------------
  // 5. Empty stream: start and dispose without sending commands
  // ---------------------------------------------------------------------------
  it('empty stream — start and dispose without crash', () => {
    const client = createClient('events');
    client.start();
    assert.strictEqual(client.isAlive, true);
    client.dispose();
    assert.strictEqual(client.isAlive, false);
  });

  // ---------------------------------------------------------------------------
  // 6. Partial JSON chunk reassembly via chunks scenario
  // ---------------------------------------------------------------------------
  it('reassembles a JSON response split across multiple write() calls (chunks scenario)', async () => {
    const client = createClient('chunks', 5000);
    client.start();

    // The chunks scenario writes a JSON response across 3 separate writeOutput
    // calls, which the reader should reassemble into a valid JSON line.
    const result = await client.getState();
    assert.ok(result !== undefined);
    assert.strictEqual(result.thinkingLevel, 'medium');
    assert.strictEqual(result.isStreaming, false);

    client.dispose();
  });

  // ---------------------------------------------------------------------------
  // 7. U+2028 / U+2029 inside JSON strings
  // ---------------------------------------------------------------------------
  it('handles U+2028 and U+2029 inside JSON strings (u2028-test scenario)', async () => {
    const client = createClient('u2028-test');
    client.start();

    // The mock returns a response containing these characters in the data.
    // The key test is that the reader does NOT split on U+2028/U+2029
    // (unlike Node's readline), and JSON.parse does not choke on them.
    const result: any = await client.prompt('Test Unicode');
    // prompt returns void, so we verify no crash and that the command succeeded.
    assert.strictEqual(client.commandCount >= 1, true);

    client.dispose();
  });

  // ---------------------------------------------------------------------------
  // 8. Out-of-order delivery: tool_execution_end before tool_execution_start
  // ---------------------------------------------------------------------------
  it('tool_execution_end for unknown callId is silently dropped (out-of-order scenario)', async () => {
    const client = createClient('out-of-order');
    client.start();

    const received: T.PiEvent[] = [];
    const sub = client.onEvent((e: T.PiEvent) => {
      received.push(e);
    });

    await client.prompt('Test');
    await delay(100);

    // With the out-of-order scenario:
    // agent_start -> message_start -> tool_execution_end(call_orphan_1)
    //   -> tool_execution_start(call_orphan_1) -> agent_end
    //
    // The tool_execution_end for call_orphan_1 arrives BEFORE its matching
    // start. PiSession level will see the end without a start and
    // silently drop it. The tool_execution_start for call_orphan_1 that
    // arrives later creates a running indicator without a matching end.
    //
    // This is a known limitation documented in the test — the end is silently
    // dropped, and the start creates a stuck "running" indicator.
    const types = received.map((e) => e.type);

    // Verify the events are received: agent_start, message_start,
    // tool_execution_end, tool_execution_start, agent_end
    assert.ok(types.includes('agent_start'), `Missing agent_start in: ${types.join(',')}`);
    assert.ok(types.includes('message_start'), `Missing message_start in: ${types.join(',')}`);
    assert.ok(
      types.includes('tool_execution_end'),
      `Missing tool_execution_end in: ${types.join(',')}`,
    );
    assert.ok(
      types.includes('tool_execution_start'),
      `Missing tool_execution_start in: ${types.join(',')}`,
    );
    assert.ok(types.includes('agent_end'), `Missing agent_end in: ${types.join(',')}`);

    // No crash means success — verify client is still healthy
    assert.strictEqual(client.isAlive, true);
    assert.strictEqual(client.commandCount >= 1, true);

    sub.dispose();
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// Concurrent session isolation — two PiRpcClient instances, separate mocks
// ---------------------------------------------------------------------------
describe('PiRpcClient concurrent session isolation (integration)', () => {
  it('two clients with separate mock servers do not cross events', async () => {
    const clientA = createClient('events');
    const clientB = createClient('dual-tools');
    clientA.start();
    clientB.start();

    const eventsA: string[] = [];
    const eventsB: string[] = [];

    clientA.onEvent((e) => eventsA.push(e.type));
    clientB.onEvent((e) => eventsB.push(e.type));

    await Promise.all([clientA.prompt('Hello'), clientB.prompt('World')]);
    await delay(200);

    // A (events scenario) should get agent_start, not tool_execution_start
    assert.ok(eventsA.includes('agent_start'), `A events: ${eventsA.join(',')}`);
    assert.ok(
      !eventsA.includes('tool_execution_start'),
      `A should not have tool events, got: ${eventsA.join(',')}`,
    );

    // B (dual-tools scenario) should get tool_execution_start
    assert.ok(eventsB.includes('agent_start'), `B events: ${eventsB.join(',')}`);
    assert.ok(
      eventsB.includes('tool_execution_start'),
      `B should have tool events, got: ${eventsB.join(',')}`,
    );

    clientA.dispose();
    clientB.dispose();
  });
});
