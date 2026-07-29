import assert from 'assert';
import sinon from 'sinon';
import * as vscode from 'vscode';
import { ChatProvider } from '../../src/view/ChatProvider';
import type { ExtensionContext } from '../../src/types/ExtensionContext';
import type { SessionManager } from '../../src/session/SessionManager';
import type { DiffController } from '../../src/diff/DiffController';
import type { PiSession } from '../../src/session/PiSession';
import type { WebviewToHost } from '../../src/view/WebviewMessenger';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMockSession(overrides?: Partial<PiSession>): PiSession {
  return {
    id: 'mock-session-1',
    state: null,
    client: { isAlive: true } as any,
    onEvent: () => ({ dispose: () => {} }),
    onDidChangeState: () => ({ dispose: () => {} }),
    prompt: async () => {},
    steer: async () => {},
    abort: async () => {},
    setModel: async () => {},
    cycleModel: async () => {},
    setThinkingLevel: async () => {},
    refreshState: async () => null,
    getMessages: async () => [],
    dispose: () => {},
    ...overrides,
  } as unknown as PiSession;
}

function createMockSessionManager(session: PiSession | null): SessionManager {
  return {
    active: session,
    onDidChange: () => ({ dispose: () => {} }),
    list: () => (session ? [session] : []),
  } as unknown as SessionManager;
}

function createMockDiffController(): DiffController {
  return {
    acceptCurrent: async () => {},
    revertCurrent: async () => {},
  } as unknown as DiffController;
}

function createExtensionContext(configOverrides?: Record<string, unknown>): ExtensionContext {
  return {
    config: {
      executable: 'pi',
      extraArgs: () => [],
      cwd: () => '/fake/workspace',
      autoReconnect: true,
      maxConcurrentSessions: 3,
      autosaveFiles: false,
      respectGitIgnore: true,
      ...configOverrides,
    } as any,
    vscodeContext: {
      extensionUri: { fsPath: '/fake/extension/path' },
      globalStorageUri: { fsPath: '/fake/global/storage' },
    } as any,
    showOutputChannel: () => {},
    log: () => {},
  } as ExtensionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatProvider dispatch', () => {
  let sandbox: sinon.SinonSandbox;
  let mockSession: PiSession;
  let mockSessionManager: SessionManager;
  let mockDiff: DiffController;
  let ctx: ExtensionContext;
  let provider: ChatProvider;
  let mockWebview: any;
  let mockWebviewView: any;
  let webviewCallback: ((data: unknown) => void) | null = null;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockSession = createMockSession();
    mockSessionManager = createMockSessionManager(mockSession);
    mockDiff = createMockDiffController();
    ctx = createExtensionContext();
    provider = new ChatProvider(ctx, mockSessionManager, mockDiff);

    webviewCallback = null;
    mockWebview = {
      postMessage: sandbox.stub().resolves(true),
      onDidReceiveMessage: (cb: any) => {
        webviewCallback = cb;
        return { dispose: () => {} };
      },
      options: {},
      html: '',
      asWebviewUri: (uri: any) => uri,
    };
    mockWebviewView = {
      webview: mockWebview,
      show: () => {},
      onDidChangeVisibility: () => ({ dispose: () => {} }),
      visible: true,
    };
    // Initialize the provider with our mock webview view
    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
  });

  afterEach(() => {
    provider.dispose();
    sandbox.restore();
  });

  // -----------------------------------------------------------------------
  // Success paths — 14 scenarios
  // -----------------------------------------------------------------------

  it('prompt calls s.prompt() with text and images', async () => {
    const stub = sandbox.stub(mockSession, 'prompt').resolves();
    const msg: WebviewToHost = { kind: 'prompt', text: 'hello', images: [] };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('hello', []));
  });

  it('steer calls s.steer() with text', async () => {
    const stub = sandbox.stub(mockSession, 'steer').resolves();
    const msg: WebviewToHost = { kind: 'steer', text: 'do more' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('do more'));
  });

  it('autosaveFiles: true calls saveAll before prompt', async () => {
    const saveStub = sandbox.stub(vscode.workspace, 'saveAll').resolves(true);
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const autosaveCtx = createExtensionContext({ autosaveFiles: true });
    const autosaveProvider = new ChatProvider(autosaveCtx, mockSessionManager, mockDiff);
    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'hi', images: [] };
      await autosaveProvider['dispatch'](msg);
      assert.ok(saveStub.calledOnceWith(false));
      assert.ok(promptStub.calledOnceWith('hi', []));
    } finally {
      autosaveProvider.dispose();
    }
  });

  it('abort calls s.abort()', async () => {
    const stub = sandbox.stub(mockSession, 'abort').resolves();
    const msg: WebviewToHost = { kind: 'abort' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnce);
  });

  it('setModel calls s.setModel() with provider/modelId', async () => {
    const stub = sandbox.stub(mockSession, 'setModel').resolves();
    const msg: WebviewToHost = { kind: 'setModel', provider: 'anthropic', modelId: 'claude-sonnet-4' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('anthropic', 'claude-sonnet-4'));
  });

  it('cycleModel calls s.cycleModel() with direction', async () => {
    const stub = sandbox.stub(mockSession, 'cycleModel').resolves();
    const msg: WebviewToHost = { kind: 'cycleModel', direction: 'next' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('next'));
  });

  it('setThinkingLevel calls s.setThinkingLevel() with level', async () => {
    const stub = sandbox.stub(mockSession, 'setThinkingLevel').resolves();
    const msg: WebviewToHost = { kind: 'setThinkingLevel', level: 'high' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('high'));
  });

  it('login calls s.prompt() with /login', async () => {
    const stub = sandbox.stub(mockSession, 'prompt').resolves();
    const msg: WebviewToHost = { kind: 'login' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('/login'));
  });

  it('logout calls s.prompt() with /logout', async () => {
    const stub = sandbox.stub(mockSession, 'prompt').resolves();
    const msg: WebviewToHost = { kind: 'logout' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnceWith('/logout'));
  });

  it('acceptDiff calls diff.acceptCurrent()', async () => {
    const stub = sandbox.stub(mockDiff, 'acceptCurrent').resolves();
    const msg: WebviewToHost = { kind: 'acceptDiff' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnce);
  });

  it('rejectDiff calls diff.revertCurrent()', async () => {
    const stub = sandbox.stub(mockDiff, 'revertCurrent').resolves();
    const msg: WebviewToHost = { kind: 'rejectDiff' };
    await provider['dispatch'](msg);
    assert.ok(stub.calledOnce);
  });

  it('requestFileSuggestions does not throw', async () => {
    const msg: WebviewToHost = { kind: 'requestFileSuggestions' };
    // Fire-and-forget — just verify no synchronous error.
    await provider['dispatch'](msg);
  });

  it('removeContextItem does not throw', async () => {
    const msg: WebviewToHost = { kind: 'removeContextItem', id: 'file-1' };
    await provider['dispatch'](msg);
  });

  it('unknown kind is silently ignored (default: break)', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();
    await provider['dispatch']({ kind: 'unknown' } as unknown as WebviewToHost);
    assert.ok(promptStub.notCalled);
  });

  it('no active session silently drops the message', async () => {
    const noSessionMgr = createMockSessionManager(null);
    const noSessionProvider = new ChatProvider(ctx, noSessionMgr, mockDiff);
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();
    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'hi', images: [] };
      await noSessionProvider['dispatch'](msg);
      // s.prompt should not be called since there is no active session
      assert.ok(promptStub.notCalled);
    } finally {
      noSessionProvider.dispose();
    }
  });

  // -----------------------------------------------------------------------
  // Permission mode guard — 5 scenarios
  // -----------------------------------------------------------------------

  it('readonly mode blocks prompt and shows error', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();
    const errorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    const readonlyCtx = createExtensionContext({ permissionMode: 'readonly' });
    const readonlyProvider = new ChatProvider(readonlyCtx, mockSessionManager, mockDiff);
    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'hello', images: [] };
      await readonlyProvider['dispatch'](msg);
      assert.ok(errorStub.calledOnce);
      assert.ok(errorStub.firstCall.args[0].includes('readonly'));
      assert.ok(promptStub.notCalled);
    } finally {
      readonlyProvider.dispose();
    }
  });

  it('plan mode blocks steer and shows error', async () => {
    const steerStub = sandbox.stub(mockSession, 'steer').resolves();
    const errorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    const planCtx = createExtensionContext({ permissionMode: 'plan' });
    const planProvider = new ChatProvider(planCtx, mockSessionManager, mockDiff);
    try {
      const msg: WebviewToHost = { kind: 'steer', text: 'do more' };
      await planProvider['dispatch'](msg);
      assert.ok(errorStub.calledOnce);
      assert.ok(errorStub.firstCall.args[0].includes('plan'));
      assert.ok(steerStub.notCalled);
    } finally {
      planProvider.dispose();
    }
  });

  it('dangerous command in auto mode shows warning and blocks when cancelled', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const dispatchPromise = provider['dispatch']({ kind: 'prompt', text: 'sudo rm -rf /', images: [] });

    // Wait a tiny tick for commandPreview to be posted
    await new Promise((r) => setTimeout(r, 5));

    const previewCall = mockWebview.postMessage.getCalls().find((c: any) => c.args[0]?.kind === 'commandPreview');
    assert.ok(previewCall, 'commandPreview should be posted');
    const sentMsg = previewCall.args[0];
    assert.strictEqual(sentMsg.risk, 'dangerous');
    const pid = sentMsg.previewId;

    // Simulate user cancelling via webview callback
    webviewCallback!({ kind: 'cancelCommand', previewId: pid });

    await dispatchPromise;
    assert.ok(promptStub.notCalled);
  });

  it('dangerous command in bypass mode skips warning and executes', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const bypassCtx = createExtensionContext({ permissionMode: 'bypass' });
    const bypassProvider = new ChatProvider(bypassCtx, mockSessionManager, mockDiff);
    bypassProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'sudo rm -rf /', images: [] };
      await bypassProvider['dispatch'](msg);
      assert.ok(promptStub.calledOnce);
    } finally {
      bypassProvider.dispose();
    }
  });

  it('dangerous command proceeds when user confirms', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const dispatchPromise = provider['dispatch']({ kind: 'prompt', text: 'sudo rm -rf /', images: [] });

    await new Promise((r) => setTimeout(r, 5));

    const previewCall = mockWebview.postMessage.getCalls().find((c: any) => c.args[0]?.kind === 'commandPreview');
    assert.ok(previewCall, 'commandPreview should be posted');
    const sentMsg = previewCall.args[0];
    const pid = sentMsg.previewId;

    // Simulate user confirming via webview callback
    webviewCallback!({ kind: 'confirmCommand', previewId: pid });

    await dispatchPromise;
    assert.ok(promptStub.calledOnce);
  });

  it('handles s.prompt() rejection gracefully — shows error message', async () => {
    sandbox.stub(mockSession, 'prompt').rejects(new Error('RPC timeout'));
    const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    const msg: WebviewToHost = { kind: 'prompt', text: 'hello', images: [] };
    await provider['dispatch'](msg);

    assert.ok(showErrorStub.calledOnce);
    assert.ok(showErrorStub.firstCall.args[0].includes('RPC timeout'));
  });

  it('handles diff.acceptCurrent() throw — shows error message', async () => {
    sandbox.stub(mockDiff, 'acceptCurrent').rejects(new Error('no diff pending'));
    const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    const msg: WebviewToHost = { kind: 'acceptDiff' };
    await provider['dispatch'](msg);

    assert.ok(showErrorStub.calledOnce);
    assert.ok(showErrorStub.firstCall.args[0].includes('no diff pending'));
  });

  it('autosave failure does not swallow prompt — prompt still called', async () => {
    sandbox.stub(vscode.workspace, 'saveAll').rejects(new Error('disk full'));
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const autosaveCtx = createExtensionContext({ autosaveFiles: true });
    const autosaveProvider = new ChatProvider(autosaveCtx, mockSessionManager, mockDiff);
    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'hi', images: [] };
      await autosaveProvider['dispatch'](msg);
      // The saveAll rejection should be caught and the prompt should still go through
      assert.ok(promptStub.calledOnceWith('hi', []));
    } finally {
      autosaveProvider.dispose();
    }
  });

  it('30s timeout on askForConfirmation auto-rejects with false', async () => {
    // Override timeout limit to 20ms for fast test execution
    (provider as any).CONFIRM_TIMEOUT_MS = 20;

    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();
    const msg: WebviewToHost = { kind: 'prompt', text: 'sudo rm -rf /', images: [] };

    const dispatchPromise = provider['dispatch'](msg);

    // Wait past 20ms timeout
    await new Promise((r) => setTimeout(r, 40));

    await dispatchPromise;
    // Should have auto-rejected due to timeout, meaning prompt was not executed
    assert.ok(promptStub.notCalled);
  });
});
