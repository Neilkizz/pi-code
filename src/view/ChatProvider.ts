import * as vscode from "vscode";
import type { ExtensionContext } from "../types/ExtensionContext";
import type { SessionManager } from "../session/SessionManager";
import type { DiffController } from "../diff/DiffController";
import type { PiSession } from "../session/PiSession";
import type * as T from "../rpc/types";
import {
	decodeFromWebview,
	postToWebview,
	type WebviewToHost,
} from "./WebviewMessenger";

/**
 * ChatProvider — implements vscode.WebviewViewProvider for the side-panel
 * Pi chat view. It renders a React webview and relays Pi events ←→ UI via
 * postMessage.
 *
 * One ChatProvider handles all sessions — the webview switches which session
 * is "active" when SessionManager.active changes.
 */
export class ChatProvider implements vscode.WebviewViewProvider {
	static readonly viewId = "piChat";

	private webviewView: vscode.WebviewView | null = null;
	private eventSubs = new Map<string, vscode.Disposable>();
	private disposables: vscode.Disposable[] = [];

	constructor(
		private ctx: ExtensionContext,
		private sessions: SessionManager,
		private diff: DiffController,
	) {
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
			localResourceRoots: [
				vscode.Uri.joinPath(this.ctx.vscodeContext.extensionUri, "webview/out"),
			],
		};
		wv.html = this.buildHtml(wv);

		// Webview → Host (user actions)
		wv.onDidReceiveMessage((data: unknown) => {
			const msg = decodeFromWebview(data);
			if (!msg) return;
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
					vscode.window.showErrorMessage(
						`Pi Code: failed to start Pi session — ${err.message}`,
					);
				});
		}
	}

	reveal(): void {
		this.webviewView?.show(true);
		void vscode.commands.executeCommand("setContext", "piChatFocus", true);
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
				kind: "stateSnapshot",
				sessionId: s.id,
				sessionName: state.sessionName,
				model: state.model,
				thinkingLevel: state.thinkingLevel || "medium",
				isStreaming: state.isStreaming,
				isCompacting: state.isCompacting,
				messageCount: state.messageCount,
			});
			const history = await s.getMessages();
			if (!this.webviewView) return;
			postToWebview(this.webviewView.webview, {
				kind: "history",
				sessionId: s.id,
				messages: history,
			});
		} catch (err) {
			this.ctx.log("error", `pushState failed: ${(err as Error).message}`);
		}
		// Fire-and-forget supplementary status pushes.
		void this.pushContext();
		void this.pushGitStatus();
	}

	/**
	 * Push workspace file suggestions to the webview for @-mention autocomplete.
	 * Scans workspace files (up to 200) and open editors.
	 */
	private async pushFileSuggestions(): Promise<void> {
		const wv = this.webviewView;
		if (!wv) return;
		try {
			const excludePattern = this.ctx.config.respectGitIgnore
				? "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/__pycache__/**,**/.env*}"
				: undefined;
			const uris = await vscode.workspace.findFiles("**/*", excludePattern, 200);
			const files = uris.map((uri) => ({
				path: vscode.workspace.asRelativePath(uri),
				isFile: true,
			}));
			// Also include open editor tabs.
			for (const doc of vscode.workspace.textDocuments) {
				if (doc.isUntitled || doc.uri.scheme !== "file") continue;
				const relPath = vscode.workspace.asRelativePath(doc.uri);
				if (!files.some((f) => f.path === relPath)) {
					files.push({ path: relPath, isFile: true });
				}
			}
			postToWebview(wv.webview, { kind: "fileSuggestions", files });
		} catch (err) {
			this.ctx.log("warn", `pushFileSuggestions failed: ${(err as Error).message}`);
		}
	}

	// ---------------------------------------------------------------------------
	// Event subscription for the active session
	// ---------------------------------------------------------------------------

	private syncSubscriptions(): void {
		const fresh = new Set(this.sessions.list().map((s) => s.id));
		for (const session of this.sessions.list()) {
			if (!this.eventSubs.has(session.id)) {
				const sub = session.onEvent((e: T.PiEvent) =>
					this.forward(session.id, e),
				);
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
		postToWebview(wv.webview, { kind: "piEvent", sessionId, event: e });
		// Track file modifications for the change summary (F-414).
		if (e.type === "tool_execution_end") {
			const end = e as T.ToolExecutionEndEvent;
			if (end.toolName === "edit" || end.toolName === "write") {
				const filePath =
					typeof end.result?.details === "object"
						? ((end.result.details as any)?.file_path ?? "")
						: "";
				if (filePath) {
					const details = (end.result?.details ?? {}) as Record<string, unknown>;
					this.trackChange(end.toolCallId, filePath, details);
				}
			}
		}
		if (e.type === "turn_end") {
			void this.pushState();
			void this.pushChangeSummary();
		}
	}

	/**
	 * Build the current context (active file, selection, git status) and push it
	 * to the webview so the user can see what will be sent (F-113/114).
	 * Reads the editor's in-memory buffer, not just the disk version (F-104).
	 */
	private async pushContext(): Promise<void> {
		const wv = this.webviewView;
		if (!wv) return;
		try {
			const items: import("./WebviewMessenger").ContextItem[] = [];
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const path = vscode.workspace.asRelativePath(editor.document.uri);
				const dirty = editor.document.isDirty;
				items.push({ type: "file", path, label: path, detail: dirty ? "unsaved changes" : "active file", removable: false, id: "file-active" });
				if (!editor.selection.isEmpty) {
					const lines = `${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`;
					const liveText = editor.document.getText(editor.selection);
					items.push({
						type: "selection", path, label: `${path}:${lines}`,
						detail: `${liveText.length} chars (from buffer)`,
						removable: true, id: `sel-${path}`,
					});
				}
			}
			const diagnostics = vscode.languages.getDiagnostics();
			let diagCount = 0;
			for (const [, diags] of diagnostics) diagCount += diags.length;
			if (diagCount > 0) {
				items.push({ type: "diagnostic", label: `${diagCount} diagnostics`, detail: "from Problems panel", removable: true, id: "diagnostics-all" });
			}
			postToWebview(wv.webview, { kind: "contextUpdate", items });
		} catch {
			// non-critical — ignore
		}
	}

	/**
	 * Read Git status from VS Code's built-in Git extension and push to webview (F-110).
	 */
	private async pushGitStatus(): Promise<void> {
		try {
			const gitExt = vscode.extensions.getExtension("vscode.git");
			if (!gitExt?.isActive) return;
			const api = gitExt.exports.getAPI(1);
			const repo = api.repositories[0];
			if (!repo) return;
			const wv = this.webviewView;
			if (!wv) return;
			const state = repo.state;
			postToWebview(wv.webview, {
				kind: "gitStatus",
				branch: state.HEAD?.name ?? state.HEAD?.commit?.slice(0, 7) ?? "detached",
				modified: state.workingTreeChanges.filter((c: any) => c.status === 1).length,
				added: state.workingTreeChanges.filter((c: any) => c.status === 7 || c.status === 5).length,
				deleted: state.workingTreeChanges.filter((c: any) => c.status === 3).length,
				ahead: state.HEAD?.ahead ?? 0,
				behind: state.HEAD?.behind ?? 0,
			});
		} catch {
			// Git integration not available — skip silently
		}
	}

	/** Track file modifications across a turn for the change summary (F-414). */
	private pendingChanges: { file: string; action: string; added: number; removed: number }[] = [];
	private trackChange(toolCallId: string, filePath: string, details: Record<string, unknown>): void {
		const diff = details.diff as string | undefined;
		if (!diff) return;
		const lines = diff.split("\n");
		let added = 0, removed = 0;
		for (const line of lines) {
			if (line.startsWith("+") && !line.startsWith("+++")) added++;
			if (line.startsWith("-") && !line.startsWith("---")) removed++;
		}
		const action = details.created ? "create" : added > 0 && removed > added ? "modify" : "modify";
		this.pendingChanges.push({ file: filePath, action, added, removed });
	}

	private async pushChangeSummary(): Promise<void> {
		const wv = this.webviewView;
		if (!wv || this.pendingChanges.length === 0) return;
		const summary = this.pendingChanges
			.map((c) => `${c.action === "create" ? "CREATED" : "MODIFIED"} ${c.file} (+${c.added}/-${c.removed})`)
			.join("\n");
		postToWebview(wv.webview, { kind: "changeSummary", summary });
		this.pendingChanges = [];
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
				case "prompt":
				case "steer":
					if (this.ctx.config.autosaveFiles) {
						await vscode.workspace.saveAll(false);
					}
					// Show context visibility before sending (F-113).
					void this.pushContext();
					if (msg.kind === "prompt") {
						await s.prompt(msg.text, msg.images);
					} else {
						await s.steer(msg.text);
					}
					break;
				case "abort":
					await s.abort();
					break;
				case "setModel":
					await s.setModel(msg.provider, msg.modelId);
					void this.pushState();
					break;
				case "cycleModel":
					await s.cycleModel(msg.direction);
					void this.pushState();
					break;
				case "setThinkingLevel":
					await s.setThinkingLevel(msg.level);
					void this.pushState();
					break;
				case "login":
					await s.prompt("/login");
					break;
				case "logout":
					await s.prompt("/logout");
					break;
				case "acceptDiff":
					await this.diff.acceptCurrent();
					break;
				case "rejectDiff":
					await this.diff.revertCurrent();
					break;
				case "requestFileSuggestions":
					void this.pushFileSuggestions();
					break;
				case "removeContextItem":
					// User removed a context item — re-push context to remove it visually.
					void this.pushContext();
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
			"webview/out/bundle.js",
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

	// ---------------------------------------------------------------------------
	// Disposal
	// ---------------------------------------------------------------------------

	dispose(): void {
		for (const sub of this.eventSubs.values()) sub.dispose();
		this.eventSubs.clear();
		for (const d of this.disposables) d.dispose();
		this.webviewView = null;
	}
}