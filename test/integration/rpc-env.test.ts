import assert from 'assert';
import { PiRpcClient } from '../../src/rpc/PiRpcClient';
import type { ExtensionContext } from '../../src/types/ExtensionContext';

function makeCtx(): ExtensionContext {
  return {
    config: {
      executable: 'node',
      // We point extraArgs to mockRpcServer.ts using ts-node
      extraArgs: () => ['-r', 'ts-node/register', 'test/integration/mockRpcServer.ts'],
      cwd: () => process.cwd(),
      autoReconnect: false,
    } as any,
    vscodeContext: {} as any,
    showOutputChannel: () => {},
    log: () => {},
  } as ExtensionContext;
}

describe('RPC Environment Inheritance Integration', function () {
  this.timeout(10000);

  it('inherits environment by default (inheritEnv=true)', async () => {
    // Set a test variable in the current process
    process.env.MY_CUSTOM_VAR = 'hello-from-parent';
    process.env.TEST_PARENT_VAR = 'inherited-ok';
    const ctx = makeCtx();

    // Use mock server's env-echo scenario by passing it in env options
    const client = new PiRpcClient({
      executable: ctx.config.executable,
      extraArgs: [...ctx.config.extraArgs()],
      cwd: ctx.config.cwd(),
      autoReconnect: false,
      skipModePrefix: true, // mock server doesn't take --mode
      env: {
        CUSTOM_LIST: 'explicit-val',
        MOCK_SCENARIO: 'env-echo',
      },
      // inheritEnv defaults to true
    });

    client.start();

    try {
      const state = await client.getState();
      const env = (state as any).env;
      assert.ok(env);
      assert.strictEqual(env.MY_CUSTOM_VAR, 'hello-from-parent');
      assert.strictEqual(env.TEST_PARENT_VAR, 'inherited-ok');
      assert.strictEqual(env.CUSTOM_LIST, 'explicit-val');
      assert.ok(env.PATH && env.PATH.length > 0);
    } finally {
      delete process.env.MOCK_SCENARIO;
      delete process.env.MY_CUSTOM_VAR;
      delete process.env.TEST_PARENT_VAR;
      client.dispose();
    }
  });

  it('does not inherit environment when inheritEnv=false', async () => {
    process.env.MY_CUSTOM_VAR = 'should-be-missing';
    process.env.TEST_PARENT_VAR = 'should-be-missing-too';
    const ctx = makeCtx();

    const client = new PiRpcClient({
      executable: ctx.config.executable,
      extraArgs: [...ctx.config.extraArgs()],
      cwd: ctx.config.cwd(),
      autoReconnect: false,
      skipModePrefix: true,
      inheritEnv: false, // explicitly disable
      env: {
        MY_CUSTOM_VAR: 'overridden-explicitly',
        CUSTOM_LIST: 'only-explicit-env',
        MOCK_SCENARIO: 'env-echo',
        PATH: process.env.PATH ?? '', // Needed so node/ts-node can be found/executed
      },
    });

    client.start();

    try {
      const state = await client.getState();
      const env = (state as any).env;
      assert.ok(env);
      // MY_CUSTOM_VAR should be our explicit value, not process.env one
      assert.strictEqual(env.MY_CUSTOM_VAR, 'overridden-explicitly');
      assert.strictEqual(env.CUSTOM_LIST, 'only-explicit-env');
      // TEST_PARENT_VAR should be null/empty because inheritEnv is false and we didn't pass it
      assert.strictEqual(env.TEST_PARENT_VAR, null);
    } finally {
      delete process.env.MOCK_SCENARIO;
      delete process.env.MY_CUSTOM_VAR;
      delete process.env.TEST_PARENT_VAR;
      client.dispose();
    }
  });
});
