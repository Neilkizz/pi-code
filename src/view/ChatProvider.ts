import * as vscode from 'vscode';
import type { ExtensionContext } from '../types/ExtensionContext';
import type { SessionManager } from '../session/SessionManager';
import type { DiffController } from '../diff/DiffController';
import type { PiSession } from '../session/PiSession';
import type * as T from '../rpc/types';
import { decodeFromWebview, postToWebview, type WebviewToHost } from './WebviewMessenger';
import { buildContextItems, getFileSuggestions } from './ContextBuilder';
import { readGitStatus } from './GitStatusReader';
import { ChangeTracker } from './ChangeTracker';
import { classifyCommand, type Classification } from '../security/commandClassifier';
import { AuditLog } from '../security/auditLog';

/**
 * ChatProvider — implements vscode.WebviewViewProvider for the side-panel
 * Pi chat view. It renders a React webview and relays Pi events ←→ UI via
 * postMessage.
 *
 * One ChatProvider handles all sessions — the webview switches which session
 * is "active" when SessionManager.active changes.
 */
export class ChatProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'piChat';

  private webviewView: vscode.WebviewView | null = null;
  private eventSubs = new Map<string, vscode.Disposable>();
  private disposables: vscode.Disposable[] = [];
  private tracker = new ChangeTracker();
  private auditLog: AuditLog;

  private pendingConfirmation: {
    previewId: string;
    resolve: (v: boolean) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private readonly CONFIRM_TIMEOUT_MS = 30_000;

  constructor(
    private ctx: ExtensionContext,
    private sessions: SessionManager,
    private diff: DiffController,
  ) {
    const storagePath =
      ctx.vscodeContext.globalStorageUri?.fsPath ||
      ctx.vscodeContext.extensionPath ||
      process.cwd();
    this.auditLog = new AuditLog(storagePath);

    // Resubscribe when the active session or its set changes.
    this.disposables.push(
      sessions.onDidChange(() => {
        this.syncSubscriptions();
        void this.pushState();
      }),
    );
    this.syncSubscriptions();
  }

  // ---------------------------------------------------------------------------
  // WebviewViewProvider
  // ---------------------------------------------------------------------------

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    const wv = webviewView.webview;
    wv.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.vscodeContext.extensionUri, 'webview/out')],
    };
    wv.html = this.buildHtml(wv);

    // Webview → Host (user actions)
    wv.onDidReceiveMessage((data: unknown) => {
      const msg = decodeFromWebview(data);
      if (!msg) return;
      if (msg.kind === 'confirmCommand') {
        if (this.pendingConfirmation?.previewId === msg.previewId) {
          clearTimeout(this.pendingConfirmation.timer);
          this.pendingConfirmation.resolve(true);
          this.pendingConfirmation = null;
        }
        return;
      }
      if (msg.kind === 'cancelCommand') {
        if (this.pendingConfirmation?.previewId === msg.previewId) {
          clearTimeout(this.pendingConfirmation.timer);
          this.pendingConfirmation.resolve(false);
          this.pendingConfirmation = null;
        }
        return;
      }
      void this.dispatch(msg);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.pushState();
    });

    // Refresh file suggestions on text document and workspace folder changes.
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(() => void this.pushFileSuggestions()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.pushFileSuggestions()),
    );

    // Push initial state.
    void this.pushState();
    void this.pushFileSuggestions();

    // Auto-create a session when the webview opens so Pi is immediately ready.
    if (!this.sessions.active) {
      void this.sessions
        .create()
        .then(() => {
          void this.pushState();
          // If the RPC subprocess fails to start (e.g. pi not on PATH),
          // pushState may return null before the restart-limit is hit.
          // Re-check after the max restart window (≈8s) and alert the user.
          setTimeout(() => {
            const s = this.sessions.active;
            if (s && !s.client.isAlive) {
              vscode.window.showWarningMessage(
                `Pi Code: cannot reach the "pi" executable. ` +
                  `Make sure it is installed and either on your PATH, ` +
                  `or set the absolute path in the "pi.path" setting.`,
              );
            }
          }, 12_000);
        })
        .catch((err) => {
          vscode.window.showErrorMessage(`Pi Code: failed to start Pi session — ${err.message}`);
        });
    }
  }

  reveal(): void {
    this.webviewView?.show(true);
    void vscode.commands.executeCommand('setContext', 'piChatFocus', true);
  }

  /** Push the current model list + state snapshot to the webview. */
  private async pushState(): Promise<void> {
    const wv = this.webviewView;
    const s = this.sessions.active;
    if (!wv || !s) return;
    try {
      const state = await s.refreshState();
      if (!state || !this.webviewView) return;
      postToWebview(this.webviewView.webview, {
        kind: 'stateSnapshot',
        sessionId: s.id,
        sessionName: state.sessionName,
        model: state.model,
        thinkingLevel: state.thinkingLevel || 'medium',
        isStreaming: state.isStreaming,
        isCompacting: state.isCompacting,
        messageCount: state.messageCount,
      });
      const history = await s.getMessages();
      if (!this.webviewView) return;
      postToWebview(this.webviewView.webview, {
        kind: 'history',
        sessionId: s.id,
        messages: history,
      });
    } catch (err) {
      this.ctx.log('error', `pushState failed: ${(err as Error).message}`);
    }
    // Fire-and-forget supplementary status pushes.
    void buildContextItems().then((items) => {
      if (this.webviewView) postToWebview(this.webviewView.webview, { kind: 'contextUpdate', items });
    });
    void readGitStatus().then((gitStatus) => {
      if (this.webviewView && gitStatus)
        postToWebview(this.webviewView.webview, { kind: 'gitStatus', ...gitStatus });
    });
  }

  /**
   * Push workspace file suggestions to the webview for @-mention autocomplete.
   * Scans workspace files (up to 200) and open editor tabs.
   */
  private async pushFileSuggestions(): Promise<void> {
    const wv = this.webviewView;
    if (!wv) return;
    try {
      const files = await getFileSuggestions({ respectGitIgnore: this.ctx.config.respectGitIgnore });
      postToWebview(wv.webview, { kind: 'fileSuggestions', files });
    } catch (err) {
      this.ctx.log('warn', `pushFileSuggestions failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Event subscription for the active session
  // ---------------------------------------------------------------------------

  private syncSubscriptions(): void {
    const fresh = new Set(this.sessions.list().map((s) => s.id));
    for (const session of this.sessions.list()) {
      if (!this.eventSubs.has(session.id)) {
        const sub = session.onEvent((e: T.PiEvent) => this.forward(session.id, e));
        this.eventSubs.set(session.id, sub);
      }
    }
    for (const [id, sub] of this.eventSubs) {
      if (!fresh.has(id)) {
        sub.dispose();
        this.eventSubs.delete(id);
      }
    }
  }

  private forward(sessionId: string, e: T.PiEvent): void {
    const wv = this.webviewView;
    if (!wv || this.sessions.active?.id !== sessionId) return;
    postToWebview(wv.webview, { kind: 'piEvent', sessionId, event: e });
    // Track file modifications for the change summary (F-414).
    if (e.type === 'tool_execution_end') {
      this.tracker.recordEvent(e as T.ToolExecutionEndEvent);
    }
    if (e.type === 'turn_end') {
      void this.pushState();
      const summary = this.tracker.summarize();
      if (summary && this.webviewView) {
        postToWebview(this.webviewView.webview, { kind: 'changeSummary', summary });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Webview → Host dispatcher
  // ---------------------------------------------------------------------------

  private async dispatch(msg: WebviewToHost): Promise<void> {
    const s: PiSession | null = this.sessions.active;
    if (!s) {
      // Safety net: if a stray message arrives before the auto-created session
      // is ready, silently drop it (pushState will retry on session creation).
      return;
    }
    try {
      switch (msg.kind) {
        case 'prompt':
        case 'steer': {
          // Permission mode guard (F-512).
          const mode = this.ctx.config.permissionMode;
          if (mode === 'readonly' || mode === 'plan') {
            vscode.window.showErrorMessage('Pi Code: Command execution is disabled in ' + mode + ' mode.');
            return;
          }
          const classification = classifyCommand(msg.text);
          let authorized = true;

          // Check if we need to prompt the user (CR-1)
          const needsWarning =
            (classification.risk === 'dangerous' && mode !== 'bypass') ||
            (classification.risk === 'sensitive' && mode === 'manual');

          if (needsWarning) {
            const previewId = Math.random().toString(36).substring(2, 10);
            authorized = await this.askForConfirmation(previewId, msg.text, classification);
          }

          // Record audit entry (Step 7)
          this.auditLog.record({
            kind: 'command',
            detail: msg.text,
            risk: classification.risk,
            authorized,
          });

          if (!authorized) return;

          if (this.ctx.config.autosaveFiles) {
            try {
              await vscode.workspace.saveAll(false);
            } catch (err) {
              this.ctx.log('warn', `autosave failed: ${(err as Error).message}`);
            }
          }
          // Show context visibility before sending (F-113).
          void buildContextItems().then((items) => {
            if (this.webviewView)
              postToWebview(this.webviewView.webview, { kind: 'contextUpdate', items });
          });
          if (msg.kind === 'prompt') {
            await s.prompt(msg.text, msg.images);
          } else {
            await s.steer(msg.text);
          }
          break;
        }
        case 'abort':
          await s.abort();
          break;
        case 'setModel':
          await s.setModel(msg.provider, msg.modelId);
          void this.pushState();
          break;
        case 'cycleModel':
          await s.cycleModel(msg.direction);
          void this.pushState();
          break;
        case 'setThinkingLevel':
          await s.setThinkingLevel(msg.level);
          void this.pushState();
          break;
        case 'login':
          await s.prompt('/login');
          break;
        case 'logout':
          await s.prompt('/logout');
          break;
        case 'acceptDiff':
          await this.diff.acceptCurrent();
          break;
        case 'rejectDiff':
          await this.diff.revertCurrent();
          break;
        case 'requestFileSuggestions':
          void this.pushFileSuggestions();
          break;
        case 'removeContextItem':
          void buildContextItems().then((items) => {
            if (this.webviewView)
              postToWebview(this.webviewView.webview, { kind: 'contextUpdate', items });
          });
          break;
        default:
          break;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Pi Code: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // HTML bootstrap for the webview
  // ---------------------------------------------------------------------------

  private buildHtml(webview: vscode.Webview): string {
    const bundlePath = vscode.Uri.joinPath(
      this.ctx.vscodeContext.extensionUri,
      'webview/out/bundle.js',
    );
    const bundleSrc = webview.asWebviewUri(bundlePath).toString();
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;" />
  <title>Pi Code</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${bundleSrc}"></script>
</body>
</html>`;
  }

  private askForConfirmation(
    previewId: string,
    command: string,
    classification: Classification,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingConfirmation?.previewId === previewId) {
          this.pendingConfirmation = null;
        }
        resolve(false);
      }, this.CONFIRM_TIMEOUT_MS);

      this.pendingConfirmation = { previewId, resolve, timer };

      if (this.webviewView) {
        postToWebview(this.webviewView.webview, {
          kind: 'commandPreview',
          command,
          risk: classification.risk,
          reason: classification.reason,
          previewId,
        });
      } else {
        clearTimeout(timer);
        this.pendingConfirmation = null;
        resolve(false);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  dispose(): void {
    if (this.pendingConfirmation) {
      clearTimeout(this.pendingConfirmation.timer);
      this.pendingConfirmation.resolve(false);
      this.pendingConfirmation = null;
    }
    this.auditLog.dispose();
    for (const sub of this.eventSubs.values()) sub.dispose();
    this.eventSubs.clear();
    for (const d of this.disposables) d.dispose();
    this.webviewView = null;
  }
}
