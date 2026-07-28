import * as vscode from "vscode";
import * as path from "path";
import type * as T from "../rpc/types";
import type { ExtensionContext } from "../types/ExtensionContext";
import type { SessionManager } from "../session/SessionManager";
import { resolveSafePath } from "../security/validation";

const PI_DIFF_SCHEME = "pi-diff";

// ---------------------------------------------------------------------------
// Unified diff parsing for hunk-level operations (F-403)
// ---------------------------------------------------------------------------

export interface Hunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	rawLines: string[];
}

export function parseUnifiedDiff(diff: string): Hunk[] {
	if (!diff) return [];
	const hunks: Hunk[] = [];
	const lines = diff.split("\n");
	let current: string[] = [];
	let hunkHeader: RegExpExecArray | null = null;

	for (const line of lines) {
		const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (match) {
			if (current.length > 0 && hunkHeader) {
				hunks.push({ oldStart: +hunkHeader[1], oldCount: +(hunkHeader[2] || 1), newStart: +hunkHeader[3], newCount: +(hunkHeader[4] || 1), rawLines: current });
			}
			hunkHeader = match;
			current = [line];
		} else if (hunkHeader) {
			current.push(line);
		}
	}
	if (current.length > 0 && hunkHeader) {
		hunks.push({ oldStart: +hunkHeader[1], oldCount: +(hunkHeader[2] || 1), newStart: +hunkHeader[3], newCount: +(hunkHeader[4] || 1), rawLines: current });
	}
	return hunks;
}

// ---------------------------------------------------------------------------

interface PendingDiff {
	sessionId: string;
	toolCallId: string;
	filePath: string;
	snapshot: string;
	diff: string;
	firstChangedLine?: number;
	hunks?: Hunk[];
	acceptedHunkIndices?: Set<number>;
	rejectedHunkIndices?: Set<number>;
}

class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
	private store = new Map<string, string>();
	private changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changeEmitter.event;

	set(uri: string, content: string): void {
		this.store.set(uri, content);
		this.changeEmitter.fire(vscode.Uri.parse(uri));
	}
	clear(uri: string): void { this.store.delete(uri); }
	provideTextDocumentContent(uri: vscode.Uri): string { return this.store.get(uri.toString()) ?? ""; }
	dispose(): void { this.changeEmitter.dispose(); }
}

const beingModifiedDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
	overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
	overviewRulerLane: 2 as any,
});

const modifiedLineDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
	gutterIconPath: undefined,
	overviewRulerLane: 2 as any,
	overviewRulerColor: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
});

export class DiffController implements vscode.Disposable {
	static readonly scheme = PI_DIFF_SCHEME;

	private snapshotProvider = new SnapshotContentProvider();
	private current: PendingDiff | null = null;
	private perFileBusy = new Set<string>();
	private pathByToolCallId = new Map<string, string>();
	private eventSubs = new Map<string, vscode.Disposable>();
	private disposables: vscode.Disposable[] = [];
	private activeDecorations = new Map<string, vscode.TextEditorDecorationType[]>();
	private snapshotTimes = new Map<string, number>();

	static active: DiffController | null = null;

	constructor(
		private _ctx: ExtensionContext,
		private sessions: SessionManager,
	) {
		DiffController.active = this;
		this.disposables.push(
			beingModifiedDecoration, modifiedLineDecoration,
			vscode.workspace.registerTextDocumentContentProvider(PI_DIFF_SCHEME, this.snapshotProvider),
		);
		this.disposables.push(sessions.onDidChange(() => this.syncSubscriptions()));
		this.syncSubscriptions();
	}

	private syncSubscriptions(): void {
		const live = new Set(this.sessions.list().map((s) => s.id));
		for (const s of this.sessions.list()) {
			if (!this.eventSubs.has(s.id)) {
				this.eventSubs.set(s.id, s.onEvent((e) => this.onEvent(s.id, e)));
			}
		}
		for (const [id, sub] of this.eventSubs) {
			if (!live.has(id)) { sub.dispose(); this.eventSubs.delete(id); }
		}
	}

	private async onEvent(sessionId: string, e: T.PiEvent): Promise<void> {
		if (e.type === "tool_execution_start") {
			const name = (e as T.ToolExecutionStartEvent).toolName;
			if (name === "edit" || name === "write") {
				await this.snapshotOnStart(sessionId, e as T.ToolExecutionStartEvent);
			}
		} else if (e.type === "tool_execution_end") {
			const name = (e as T.ToolExecutionEndEvent).toolName;
			if (name === "edit" || name === "write") {
				await this.presentOnEnd(sessionId, e as T.ToolExecutionEndEvent);
			}
		}
	}

	private async snapshotOnStart(sessionId: string, e: T.ToolExecutionStartEvent): Promise<void> {
		const filePath = this.extractPath(e.args);
		if (!filePath) return;
		this.pathByToolCallId.set(e.toolCallId, filePath);
		if (this.perFileBusy.has(filePath)) return;
		this.perFileBusy.add(filePath);
		try {
			const uri = vscode.Uri.file(filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			this.snapshotProvider.set(this.snapshotUri(sessionId, filePath).toString(), doc.getText());
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				this.snapshotTimes.set(filePath, stat.mtime);
			} catch { this.snapshotTimes.set(filePath, Date.now()); }
			if (this._ctx.config.autoOpenOnEdit) {
				const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
				this.applyDecoration(editor, beingModifiedDecoration, [new vscode.Range(0, 0, 0, 0)]);
			}
		} catch {
			this.snapshotProvider.set(this.snapshotUri(sessionId, filePath).toString(), "");
		}
	}

	private async presentOnEnd(sessionId: string, e: T.ToolExecutionEndEvent): Promise<void> {
		const filePath = this.pathByToolCallId.get(e.toolCallId);
		if (!filePath) return;
		this.pathByToolCallId.delete(e.toolCallId);
		const details = (e.result?.details ?? {}) as Record<string, unknown>;
		const diffStr = (details.diff as string) ?? "";
		const snapshot = this.snapshotProvider.provideTextDocumentContent(this.snapshotUri(sessionId, filePath)) ?? "";
		if (snapshot === (await this.readCurrent(filePath))) { this.perFileBusy.delete(filePath); return; }
		const hunks = parseUnifiedDiff(diffStr);
		const firstChangedLine = (details.firstChangedLine as number) ?? hunks[0]?.newStart ?? 0;
		this.current = { sessionId, toolCallId: e.toolCallId, filePath, snapshot, diff: diffStr, firstChangedLine, hunks: hunks.length > 0 ? hunks : undefined, acceptedHunkIndices: new Set(), rejectedHunkIndices: new Set() };
		await this.openDiffEditor(this.current);
	}

	private async openDiffEditor(p: PendingDiff): Promise<void> {
		const left = this.snapshotUri(p.sessionId, p.filePath);
		const right = vscode.Uri.file(p.filePath);
		await vscode.commands.executeCommand("vscode.diff", left, right, `Pi edit — ${path.basename(p.filePath)}`, { preview: false });
		if (p.firstChangedLine !== undefined && p.firstChangedLine >= 0) this.revealChangedLine(p.filePath, p.firstChangedLine);
		this.highlightModifiedFile(p.filePath, p.firstChangedLine);
		await vscode.commands.executeCommand("setContext", "piDiff", true);
		if (this._ctx.config.formatAfterEdit) {
			try {
				await vscode.commands.executeCommand("editor.action.formatDocument", vscode.Uri.file(p.filePath));
				this._ctx.log("info", `Formatted ${p.filePath} after Pi edit`);
			} catch { /* formatter not available */ }
		}
	}

	// -------------------------------------------------------------------------
	// F-403: Hunk-level accept/reject
	// -------------------------------------------------------------------------

	async acceptHunk(index: number): Promise<void> {
		const p = this.current;
		if (!p || !p.hunks || index < 0 || index >= p.hunks.length) return;
		p.acceptedHunkIndices!.add(index);
		p.rejectedHunkIndices!.delete(index);
	}

	async rejectHunk(index: number): Promise<void> {
		const p = this.current;
		if (!p || !p.hunks || index < 0 || index >= p.hunks.length) return;
		p.rejectedHunkIndices!.add(index);
		p.acceptedHunkIndices!.delete(index);
		await this.applyRejectedHunks(p);
	}

	/** Apply rejected hunks by restoring snapshot lines for each rejected hunk. */
	private async applyRejectedHunks(p: PendingDiff): Promise<void> {
		if (!p.hunks) return;
		try {
			const uri = vscode.Uri.file(p.filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			const ws = new vscode.WorkspaceEdit();
			let changed = false;
			const snapshotLines = p.snapshot.split("\n");

			for (let i = 0; i < p.hunks.length; i++) {
				if (p.rejectedHunkIndices!.has(i)) {
					const h = p.hunks[i];
					const oldStart = h.oldStart < 1 ? 0 : h.oldStart - 1;
					const oldCount = h.oldCount < 1 ? 1 : h.oldCount;
					const oldLines = snapshotLines.slice(oldStart, oldStart + oldCount);
					if (oldLines.length > 0) {
						const newStart = h.newStart < 1 ? 0 : h.newStart - 1;
						const newCount = h.newCount < 1 ? 1 : h.newCount;
						const endLine = Math.min(newStart + newCount - 1, doc.lineCount - 1);
						const range = new vscode.Range(
							new vscode.Position(newStart, 0),
							new vscode.Position(endLine, doc.lineAt(endLine).text.length),
						);
						ws.replace(uri, range, oldLines.slice(0, oldCount).join("\n"));
						changed = true;
					}
				}
			}
			if (changed) {
				await vscode.workspace.applyEdit(ws);
				this._ctx.log("info", `Applied ${p.rejectedHunkIndices!.size} rejected hunk(s) to ${path.basename(p.filePath)}`);
			}
		} catch (err) {
			this._ctx.log("error", `applyRejectedHunks failed: ${(err as Error).message}`);
		}
	}

	// -------------------------------------------------------------------------
	// F-406: Conflict detection before revert
	// -------------------------------------------------------------------------

	private async detectConflict(filePath: string): Promise<string | null> {
		const snapshotTime = this.snapshotTimes.get(filePath);
		if (!snapshotTime) return null;
		try {
			const uri = vscode.Uri.file(filePath);
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.mtime > snapshotTime + 1000) {
				return `File ${path.basename(filePath)} was modified by you after Pi edited it. Reverting may lose your changes.`;
			}
		} catch { return `File ${path.basename(filePath)} no longer exists. Cannot revert.`; }
		return null;
	}

	// -------------------------------------------------------------------------

	private async revealChangedLine(filePath: string, line: number): Promise<void> {
		try {
			const uri = vscode.Uri.file(filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false, viewColumn: vscode.ViewColumn.Active });
			const targetLine = Math.max(0, Math.min(line - 1, doc.lineCount - 1));
			const tr = new vscode.Range(targetLine, 0, targetLine, 0);
			editor.selection = new vscode.Selection(tr.start, tr.start);
			editor.revealRange(tr, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		} catch { /* ignore */ }
	}

	private async highlightModifiedFile(filePath: string, firstChangedLine?: number): Promise<void> {
		try {
			const uri = vscode.Uri.file(filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			const editors = vscode.window.visibleTextEditors.filter((ed) => ed.document.uri.toString() === uri.toString());
			if (editors.length === 0) return;
			const editor = editors[0];
			this.clearDecoration(filePath);
			if (firstChangedLine !== undefined && firstChangedLine >= 0) {
				const sl = Math.max(0, firstChangedLine - 1);
				const el = Math.min(sl + 5, doc.lineCount - 1);
				const range = new vscode.Range(sl, 0, el, doc.lineAt(el).text.length);
				editor.setDecorations(modifiedLineDecoration, [range]);
				this.activeDecorations.set(filePath, [modifiedLineDecoration]);
			}
		} catch { /* ignore */ }
	}

	private applyDecoration(editor: vscode.TextEditor, dt: vscode.TextEditorDecorationType, ranges: vscode.Range[]): void {
		editor.setDecorations(dt, ranges);
	}

	private clearDecoration(filePath: string): void {
		const decorations = this.activeDecorations.get(filePath);
		if (decorations) {
			try {
				const uri = vscode.Uri.file(filePath);
				for (const ed of vscode.window.visibleTextEditors) {
					if (ed.document.uri.toString() === uri.toString()) {
						for (const dec of decorations) ed.setDecorations(dec, []);
					}
				}
			} catch { /* ignore */ }
			this.activeDecorations.delete(filePath);
		}
	}

	private snapshotUri(sessionId: string, filePath: string): vscode.Uri {
		return vscode.Uri.parse(`${PI_DIFF_SCHEME}://pi/${encodeURIComponent(sessionId + "|" + filePath)}`);
	}

	private extractPath(args: any): string | undefined {
		if (!args || typeof args !== "object") return undefined;
		const rawPath = args.file_path ?? args.path ?? args.filePath;
		if (!rawPath || typeof rawPath !== "string") return undefined;
		return resolveSafePath(rawPath, this._ctx.config.cwd()) ?? undefined;
	}

	private async readCurrent(filePath: string): Promise<string> {
		try { const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath)); return doc.getText(); }
		catch { return ""; }
	}

	async acceptCurrent(): Promise<void> {
		if (this.current) { this.clearDecoration(this.current.filePath); this.perFileBusy.delete(this.current.filePath); this.current = null; }
		await vscode.commands.executeCommand("setContext", "piDiff", false);
		vscode.window.showInformationMessage("Pi edit kept. Save the file to persist.");
	}

	async revertCurrent(): Promise<void> {
		const p = this.current;
		if (!p) { vscode.window.showWarningMessage("No Pi edit to revert."); return; }
		const conflict = await this.detectConflict(p.filePath);
		if (conflict) {
			const action = await vscode.window.showWarningMessage(conflict, "Revert anyway", "Cancel");
			if (action !== "Revert anyway") return;
		}
		const ws = new vscode.WorkspaceEdit();
		const uri = vscode.Uri.file(p.filePath);
		const doc = await vscode.workspace.openTextDocument(uri);
		ws.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), p.snapshot, { needsConfirmation: false, label: "Pi revert" } as any);
		const ok = await vscode.workspace.applyEdit(ws);
		if (!ok) { vscode.window.showErrorMessage(`Failed to revert ${p.filePath}.`); return; }
		this.clearDecoration(p.filePath);
		const session = this.sessions.list().find((s) => s.id === p.sessionId);
		if (session && session.state?.isStreaming) void session.steer(`I reverted your edit to ${path.basename(p.filePath)}. Please try a different approach.`);
		this.perFileBusy.delete(p.filePath);
		this.current = null;
		await vscode.commands.executeCommand("setContext", "piDiff", false);
		vscode.window.showInformationMessage(`Reverted Pi edit to ${path.basename(p.filePath)}.`);
	}

	dispose(): void {
		for (const sub of this.eventSubs.values()) sub.dispose();
		this.eventSubs.clear();
		this.snapshotProvider.dispose();
		for (const d of this.disposables) d.dispose();
		if (DiffController.active === this) DiffController.active = null;
	}
}
