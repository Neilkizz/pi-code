import assert from 'assert';
import sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChatProvider } from '../../src/view/ChatProvider';
import { type ExtensionContext } from '../../src/types/ExtensionContext';
import { type SessionManager } from '../../src/session/SessionManager';
import { type DiffController } from '../../src/diff/DiffController';
import { type PiSession } from '../../src/session/PiSession';
import { type WebviewToHost } from '../../src/view/WebviewMessenger';

function createMockSession(overrides?: Partial<PiSession>): PiSession {
  return {
    id: 'mock-session-int',
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
      globalStorageUri: { fsPath: path.join(__dirname, 'integration-audit-test') },
    } as any,
    showOutputChannel: () => {},
    log: () => {},
  } as ExtensionContext;
}

describe('Phase 3 Integration: Command Classification, Preview, and Audit Flow', () => {
  let sandbox: sinon.SinonSandbox;
  let mockSession: PiSession;
  let mockSessionManager: SessionManager;
  let mockDiff: DiffController;
  let ctx: ExtensionContext;
  let provider: ChatProvider;
  let mockWebview: any;
  let mockWebviewView: any;
  let webviewCallback: ((data: unknown) => void) | null = null;
  let auditDir: string;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockSession = createMockSession();
    mockSessionManager = createMockSessionManager(mockSession);
    mockDiff = createMockDiffController();
    ctx = createExtensionContext();
    auditDir = ctx.vscodeContext.globalStorageUri!.fsPath;

    try {
      fs.mkdirSync(auditDir, { recursive: true });
    } catch {
      /* ignore */
    }

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
    provider = new ChatProvider(ctx, mockSessionManager, mockDiff);
    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
  });

  afterEach(() => {
    provider.dispose();
    sandbox.restore();

    // Clean up audit dir
    try {
      if (fs.existsSync(auditDir)) {
        const files = fs.readdirSync(auditDir);
        for (const f of files) fs.unlinkSync(path.join(auditDir, f));
        fs.rmdirSync(auditDir);
      }
    } catch {
      /* ignore */
    }
  });

  // Scenario 1: Safe command in auto mode -> dispatch continues -> audit entry recorded (authorized=true)
  it('Scenario 1: Safe command in auto mode -> executes -> audit authorized=true', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const msg: WebviewToHost = { kind: 'prompt', text: 'echo "hello"', images: [] };
    // Simulate webview triggering dispatch
    webviewCallback!(msg);

    // Wait for async dispatch to run
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(promptStub.calledOnceWith('echo "hello"', []));

    // Verify audit log has been written to disk
    const auditFile = path.join(auditDir, 'audit.jsonl');
    assert.ok(fs.existsSync(auditFile));
    const logLines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    assert.strictEqual(logLines.length, 1);
    const entry = JSON.parse(logLines[0]);
    assert.strictEqual(entry.detail, 'echo "hello"');
    assert.strictEqual(entry.authorized, true);
  });

  // Scenario 2: Dangerous command in auto mode -> commandPreview sent -> confirmCommand received -> dispatch continues -> audit authorized=true
  it('Scenario 2: Dangerous command in auto mode -> confirmed by user -> executes -> audit authorized=true', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const msg: WebviewToHost = { kind: 'prompt', text: 'sudo rm -rf /tmp/data', images: [] };
    // This will trigger askForConfirmation and wait
    const dispatchPromise = provider['dispatch'](msg);

    await new Promise((r) => setTimeout(r, 5));

    // Check that commandPreview was posted
    const previewCall = mockWebview.postMessage
      .getCalls()
      .find((c: any) => c.args[0]?.kind === 'commandPreview');
    assert.ok(previewCall);
    const pid = previewCall.args[0].previewId;

    // Simulate user confirming
    webviewCallback!({ kind: 'confirmCommand', previewId: pid });

    await dispatchPromise;

    // Command should have run
    assert.ok(promptStub.calledOnceWith('sudo rm -rf /tmp/data', []));

    // Verify audit log
    const auditFile = path.join(auditDir, 'audit.jsonl');
    const logLines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    const entry = JSON.parse(logLines[0]);
    assert.strictEqual(entry.detail, 'sudo rm -rf /tmp/data');
    assert.strictEqual(entry.authorized, true);
  });

  // Scenario 3: Dangerous command, user cancels -> commandPreview sent -> cancelCommand -> dispatch stops -> audit authorized=false
  it('Scenario 3: Dangerous command, user cancels -> blocks -> audit authorized=false', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    const msg: WebviewToHost = { kind: 'prompt', text: 'sudo rm -rf /tmp/data', images: [] };
    const dispatchPromise = provider['dispatch'](msg);

    await new Promise((r) => setTimeout(r, 5));

    const previewCall = mockWebview.postMessage
      .getCalls()
      .find((c: any) => c.args[0]?.kind === 'commandPreview');
    assert.ok(previewCall);
    const pid = previewCall.args[0].previewId;

    // Simulate user cancelling
    webviewCallback!({ kind: 'cancelCommand', previewId: pid });

    await dispatchPromise;

    // Command should NOT have run
    assert.ok(promptStub.notCalled);

    // Verify audit log
    const auditFile = path.join(auditDir, 'audit.jsonl');
    const logLines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    const entry = JSON.parse(logLines[0]);
    assert.strictEqual(entry.detail, 'sudo rm -rf /tmp/data');
    assert.strictEqual(entry.authorized, false);
  });

  // Scenario 4: Readonly mode -> any command blocked with error -> no session.execution -> no audit
  it('Scenario 4: Readonly mode -> blocks command -> no audit written', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();
    const errorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    // Use custom ChatProvider with readonly config
    const readonlyCtx = createExtensionContext({ permissionMode: 'readonly' });
    const readonlyProvider = new ChatProvider(readonlyCtx, mockSessionManager, mockDiff);
    readonlyProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'echo "test"', images: [] };
      await readonlyProvider['dispatch'](msg);

      assert.ok(errorStub.calledOnce);
      assert.ok(promptStub.notCalled);

      // Verify no audit log exists on disk
      const auditFile = path.join(
        readonlyCtx.vscodeContext.globalStorageUri!.fsPath,
        'audit.jsonl',
      );
      assert.ok(!fs.existsSync(auditFile));
    } finally {
      readonlyProvider.dispose();
      // Clean readonly audit storage
      try {
        const p = readonlyCtx.vscodeContext.globalStorageUri!.fsPath;
        if (fs.existsSync(p)) {
          const files = fs.readdirSync(p);
          for (const f of files) fs.unlinkSync(path.join(p, f));
          fs.rmdirSync(p);
        }
      } catch {
        /* ignore */
      }
    }
  });

  // Scenario 5: Plan mode for write command -> block with "plan mode does not allow writes" -> no audit
  it('Scenario 5: Plan mode blocks writes -> no audit written', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();
    const errorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

    const planCtx = createExtensionContext({ permissionMode: 'plan' });
    const planProvider = new ChatProvider(planCtx, mockSessionManager, mockDiff);
    planProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    try {
      const msg: WebviewToHost = { kind: 'prompt', text: 'git commit -m "update"', images: [] };
      await planProvider['dispatch'](msg);

      assert.ok(errorStub.calledOnce);
      assert.ok(promptStub.notCalled);

      // Verify no audit log
      const auditFile = path.join(planCtx.vscodeContext.globalStorageUri!.fsPath, 'audit.jsonl');
      assert.ok(!fs.existsSync(auditFile));
    } finally {
      planProvider.dispose();
      // Clean plan audit storage
      try {
        const p = planCtx.vscodeContext.globalStorageUri!.fsPath;
        if (fs.existsSync(p)) {
          const files = fs.readdirSync(p);
          for (const f of files) fs.unlinkSync(path.join(p, f));
          fs.rmdirSync(p);
        }
      } catch {
        /* ignore */
      }
    }
  });

  // Scenario 6: Unknown kind -> decodeFromWebview returns null -> no dispatch -> no audit entry
  it('Scenario 6: Unknown message kind -> ignored -> no audit written', async () => {
    const promptStub = sandbox.stub(mockSession, 'prompt').resolves();

    // Trigger raw webview message callback with invalid kind
    // Since mockWebview.onDidReceiveMessage triggers our webviewCallback,
    // we pass it an arbitrary object. It should return null from decodeFromWebview and skip dispatch.
    webviewCallback!({ kind: 'invalidCommandPatternGoesHere' });

    await new Promise((r) => setTimeout(r, 10));

    assert.ok(promptStub.notCalled);

    // Verify no audit log
    const auditFile = path.join(auditDir, 'audit.jsonl');
    assert.ok(!fs.existsSync(auditFile));
  });
});
