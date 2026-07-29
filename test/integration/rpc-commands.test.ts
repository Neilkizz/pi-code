/**
 * Integration tests for PiRpcClient RPC commands — all command types round-trip
 * through the mock server.
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

describe('PiRpcClient commands (integration)', () => {
  it('prompt resolves successfully', async () => {
    const client = createClient('echo');
    client.start();
    await client.prompt('Say hello');
    assert.strictEqual(client.commandCount >= 1, true);
    client.dispose();
  });

  it('get_state returns state object', async () => {
    const client = createClient('echo');
    client.start();
    const state = await client.getState();
    assert.ok(state !== undefined);
    assert.ok(typeof state.thinkingLevel === 'string');
    assert.strictEqual(state.isStreaming, false);
    client.dispose();
  });

  it('get_available_models returns model list', async () => {
    const client = createClient('echo');
    client.start();
    const data = await client.getAvailableModels();
    assert.ok(Array.isArray(data.models));
    assert.ok(data.models.length > 0);
    assert.ok(data.models[0].id);
    client.dispose();
  });

  it('cycle_model returns model data', async () => {
    const client = createClient('echo');
    client.start();
    const data = await client.cycleModel('next');
    assert.ok(data.model !== null);
    assert.strictEqual(typeof data.thinkingLevel, 'string');
    client.dispose();
  });

  it('abort resolves without error', async () => {
    const client = createClient('echo');
    client.start();
    await client.abort();
    client.dispose();
  });

  it('new_session returns data', async () => {
    const client = createClient('echo');
    client.start();
    const data = await client.newSession();
    assert.strictEqual(data.cancelled, false);
    client.dispose();
  });

  it('set_thinking_level resolves', async () => {
    const client = createClient('echo');
    client.start();
    await client.setThinkingLevel('high');
    client.dispose();
  });

  it('set_model resolves', async () => {
    const client = createClient('echo');
    client.start();
    await client.setModel('anthropic', 'claude-sonnet-5');
    client.dispose();
  });

  it('get_messages returns message array', async () => {
    const client = createClient('echo');
    client.start();
    const result = await client.getMessages();
    assert.ok(Array.isArray(result.messages));
    client.dispose();
  });

  it('set_session_name resolves', async () => {
    const client = createClient('echo');
    client.start();
    await client.setSessionName('test-session');
    client.dispose();
  });

  it('firing events via event bus during prompt (events scenario)', async () => {
    const client = createClient('events');
    client.start();
    const received: string[] = [];
    const sub = client.onEvent((e: T.PiEvent) => {
      received.push(e.type);
    });
    await client.prompt('Hello');
    assert.ok(received.includes('agent_start'), `events received: ${received.join(', ')}`);
    assert.ok(received.includes('message_start'), `events received: ${received.join(', ')}`);
    assert.ok(received.includes('message_update'), `events received: ${received.join(', ')}`);
    assert.ok(received.includes('message_end'), `events received: ${received.join(', ')}`);
    assert.ok(received.includes('agent_end'), `events received: ${received.join(', ')}`);
    sub.dispose();
    client.dispose();
  });

  it('steer resolves', async () => {
    const client = createClient('echo');
    client.start();
    await client.steer('Try a different approach');
    client.dispose();
  });

  it('follow_up resolves', async () => {
    const client = createClient('echo');
    client.start();
    await client.followUp('Tell me more');
    client.dispose();
  });

  it('env-echo scenario returns environment variables in response', async () => {
    const client = createClient('env-echo');
    client.start();
    // Use getState — env-echo scenario returns env data for ANY command
    const result: any = await client.getState();
    assert.ok(result !== undefined);
    assert.ok(result.env !== undefined, `expected env field in: ${JSON.stringify(result)}`);
    assert.strictEqual(result.env.inherited, true);
    assert.strictEqual(typeof result.env.PATH, 'string');
    assert.ok(result.env.PATH.length > 0, 'PATH should be non-empty');
    assert.ok(result.env.HOME !== undefined, 'HOME should be present');
    // MY_CUSTOM_VAR and CUSTOM_LIST may be undefined — they come from test env
    // Just verify they're present as properties
    assert.ok('MY_CUSTOM_VAR' in result.env);
    assert.ok('CUSTOM_LIST' in result.env);
    client.dispose();
  });
});
