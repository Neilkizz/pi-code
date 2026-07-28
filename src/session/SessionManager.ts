import * as vscode from "vscode";
import * as crypto from "crypto";
import type { ExtensionContext } from "../types/ExtensionContext";
import { PiSession } from "./PiSession";

/**
 * SessionManager — owns the set of PiSession objects (one subprocess each),
 * tracks the "active" tab, enforces max concurrency, and persists the tab list
 * to globalState so sessions can be resumed across reloads.
 *
 * F-111: Sessions are associated with a workspace root in multi-root workspaces.
 */
export class SessionManager implements vscode.Disposable {
	private sessions = new Map<string, PiSession>();
	private order: string[] = [];
	private activeId: string | null = null;
	private disposables: vscode.Disposable[] = [];
	private closedSessionStack: string[] = [];
	/** F-111: Per-session workspace root (undefined = use config default). */
	private sessionRoots = new Map<string, string | undefined>();

	private changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private ctx: ExtensionContext) {}

	get active(): PiSession | null {
		return this.activeId ? (this.sessions.get(this.activeId) ?? null) : null;
	}

	get count(): number {
		return this.sessions.size;
	}

	list(): PiSession[] {
		return this.order.map((id) => this.sessions.get(id)!).filter(Boolean);
	}

	get maxConcurrent(): number {
		return this.ctx.config.maxConcurrentSessions;
	}

	/**
	 * Get the workspace root for a session, or the default workspace root.
	 * F-111: In multi-root workspaces, pick a specific root per session.
	 */
	getSessionRoot(sessionId?: string): string | undefined {
		if (sessionId && this.sessionRoots.has(sessionId)) {
			return this.sessionRoots.get(sessionId);
		}
		const folders = vscode.workspace.workspaceFolders;
		if (folders && folders.length > 0) {
			return folders[0].uri.fsPath;
		}
		return undefined;
	}

	setSessionRoot(sessionId: string, root: string): void {
		this.sessionRoots.set(sessionId, root);
	}

	/** Return available workspace folder names (for UI display). */
	getWorkspaceFolderNames(): string[] {
		return (vscode.workspace.workspaceFolders ?? []).map((f) => f.name);
	}

	async create(parent?: string, workspaceRoot?: string): Promise<PiSession> {
		if (this.sessions.size >= this.maxConcurrent) {
			await vscode.window.showWarningMessage(
				`Pi session limit reached (${this.maxConcurrent}). Close one or raise pi.maxConcurrentSessions.`,
				"OK",
			);
			throw new Error("Max concurrent Pi sessions reached");
		}
		const id = crypto.randomUUID();
		const session = new PiSession(this.ctx, id);
		this.sessions.set(id, session);
		this.order.push(id);
		if (workspaceRoot) {
			this.sessionRoots.set(id, workspaceRoot);
		}
		if (parent) {
			void session.client
				.newSession(parent)
				.catch((e) =>
					this.ctx.log("warn", `newSession(parent) failed: ${(e as Error).message}`),
				);
		}
		this.setActive(id);
		this.persistTabs();
		return session;
	}

	async forkActive(): Promise<PiSession | null> {
		const active = this.active;
		if (!active) return null;
		const parentFile = active.state?.sessionFile;
		const parentRoot = this.sessionRoots.get(active.id);
		const forked = await this.create(parentFile, parentRoot);
		return forked;
	}

	setActive(id: string): void {
		if (!this.sessions.has(id)) return;
		this.activeId = id;
		this.changeEmitter.fire();
	}

	close(id: string): void {
		const s = this.sessions.get(id);
		if (!s) return;
		s.dispose();
		this.sessions.delete(id);
		this.sessionRoots.delete(id);
		this.order = this.order.filter((x) => x !== id);
		if (this.activeId === id) {
			this.activeId = this.order[this.order.length - 1] ?? null;
		}
		this.closedSessionStack.push(id);
		this.persistTabs();
		this.changeEmitter.fire();
	}

	async restoreSaved(): Promise<void> {
		const saved = this.ctx.vscodeContext.globalState.get<string[]>("pi.tabs") ?? [];
		for (const sessionId of saved) {
			if (this.sessions.size >= this.maxConcurrent) break;
			const session = new PiSession(this.ctx, sessionId);
			this.sessions.set(sessionId, session);
			this.order.push(sessionId);
		}
		if (this.order.length > 0) this.setActive(this.order[0]);
	}

	reopenLastClosed(): PiSession | null {
		const last = this.closedSessionStack.pop();
		if (!last) return null;
		if (this.sessions.size >= this.maxConcurrent) {
			vscode.window.showWarningMessage(
				`Pi session limit reached (${this.maxConcurrent}). Close one before reopening.`,
			);
			return null;
		}
		const session = new PiSession(this.ctx, last);
		this.sessions.set(last, session);
		this.order.push(last);
		this.setActive(last);
		this.persistTabs();
		return session;
	}

	private async persistTabs(): Promise<void> {
		await this.ctx.vscodeContext.globalState.update("pi.tabs", this.order);
	}

	dispose(): void {
		for (const s of this.sessions.values()) s.dispose();
		this.sessions.clear();
		this.order = [];
		for (const d of this.disposables) d.dispose();
		this.changeEmitter.dispose();
	}
}
