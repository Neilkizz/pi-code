import * as vscode from "vscode";
import type { ExtensionContext } from "../types/ExtensionContext";
import type { SessionManager } from "../session/SessionManager";

/**
 * AuthService — Pi owns credentials (~/.pi/credentials via pi-ai). This module
 * NEVER stores or proxies API keys. It only relays `/login` and `/logout`
 * slash commands (Pi opens its own browser flow) and surfaces auth state via
 * a status-bar item derived from `getSession().state`.
 */
export class AuthService implements vscode.Disposable {
	private statusItem: vscode.StatusBarItem;
	private disposables: vscode.Disposable[] = [];
	private activeStateSub: vscode.Disposable | undefined;

	constructor(
		ctx: ExtensionContext,
		private sessions: SessionManager,
	) {
		this.statusItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100,
		);
		this.statusItem.command = "pi.login";
		this.statusItem.tooltip = "Pi authentication";
		this.disposables.push(this.statusItem);

		// Refresh status whenever the active session or its state changes.
		this.disposables.push(
			sessions.onDidChange(() => {
				this.switchActiveStateSubscription();
				this.updateStatus();
			}),
		);
		this.switchActiveStateSubscription();
		this.updateStatus();
	}

	/** Unsubscribe from the old active session and re-bind to the new one. */
	private switchActiveStateSubscription(): void {
		this.activeStateSub?.dispose();
		this.activeStateSub = undefined;
		const active = this.sessions.active;
		if (active) {
			this.activeStateSub = active.onDidChangeState(() => this.updateStatus());
		}
	}

	async login(): Promise<void> {
		const s = await this.ensureSession();
		await s.prompt("/login");
		vscode.window.showInformationMessage(
			"Pi login — complete the flow in the browser Pi opened.",
		);
	}

	async logout(): Promise<void> {
		const s = await this.ensureSession();
		await s.prompt("/logout");
		vscode.window.showInformationMessage("Logged out of Pi.");
		this.updateStatus();
	}

	async refresh(): Promise<void> {
		const s = this.sessions.active;
		if (!s) return;
		await s.refreshState();
		this.updateStatus();
	}

	private async ensureSession(): Promise<
		import("../session/PiSession").PiSession
	> {
		const existing = this.sessions.active;
		if (existing) return existing;
		// Auto-create one if none exists yet — await so the session is fully created.
		const fresh = await this.sessions.create();
		return fresh;
	}

	private updateStatus(): void {
		const s = this.sessions.active;
		const state = s?.state;
		if (state?.model) {
			this.statusItem.text = `Pi • ${state.model.provider ?? "model"}/${state.model.id ?? "?"}`;
			this.statusItem.tooltip = `Pi authenticated. Session: ${state.sessionName ?? state.sessionId ?? "?"}`;
			this.statusItem.backgroundColor = undefined;
		} else {
			this.statusItem.text = "Pi • not authenticated";
			this.statusItem.tooltip = "Click to run /login";
		}
		this.statusItem.show();
	}

	dispose(): void {
		this.activeStateSub?.dispose();
		this.activeStateSub = undefined;
		for (const d of this.disposables) d.dispose();
	}
}
