import * as vscode from "vscode";
import type { ExtensionContext } from "../types/ExtensionContext";
import type { SessionManager } from "../session/SessionManager";
import type { ChatProvider } from "../view/ChatProvider";
import type { AuthService } from "../auth/AuthService";
import type { DiffController } from "../diff/DiffController";
import type { PiTerminal } from "../terminal/PiTerminal";

/** Registers all contributes.commands and their handlers. */
export function registerCommands(
	ctx: ExtensionContext,
	sessions: SessionManager,
	chat: ChatProvider,
	auth: AuthService,
	diff: DiffController,
	terminal?: PiTerminal,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand("pi.showChat", async () => {
			await vscode.commands.executeCommand("workbench.view.extension.pi");
			chat.reveal();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.askAboutSelection", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			const selection = editor.document.getText(editor.selection);
			if (!selection.trim()) return;
			const file = vscode.workspace.asRelativePath(editor.document.uri);
			const promptText = `In ${file}, tell me about this code:\n\`\`\`\n${selection}\n\`\`\``;
			let s = sessions.active;
			if (!s) {
				s = await sessions.create();
			}
			chat.reveal();
			await s.prompt(promptText);
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.selectSession", async (id: string) => {
			sessions.setActive(id);
			chat.reveal();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.newSession", async () => {
			await sessions.create();
			chat.reveal();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.forkSession", async () => {
			await sessions.forkActive();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.abort", async () => {
			await sessions.active?.client.abort();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.cycleModel", async () => {
			const s = sessions.active;
			if (!s) return;
			await s.client.cycleModel();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.toggleTerminal", async () => {
			if (terminal) {
				terminal.show();
			} else {
				vscode.window.showWarningMessage("Pi terminal not available.");
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.acceptDiff", async () => {
			await diff.acceptCurrent();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.rejectDiff", async () => {
			await diff.revertCurrent();
		}),
	);

	// F-403: Hunk-level accept/reject commands
	subs.push(
		vscode.commands.registerCommand("pi.acceptHunk", async (index: number) => {
			await diff.acceptHunk(index);
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.rejectHunk", async (index: number) => {
			await diff.rejectHunk(index);
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.login", async () => {
			await auth.login();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.logout", async () => {
			await auth.logout();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.refreshAuth", async () => {
			await auth.refresh();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.closeSession", async () => {
			const active = sessions.active;
			if (active) {
				sessions.close(active.id);
				vscode.window.showInformationMessage("Pi session closed.");
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.showLogs", async () => {
			ctx.showOutputChannel();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.reopenSession", async () => {
			const session = sessions.reopenLastClosed();
			if (session) {
				chat.reveal();
			} else {
				vscode.window.showInformationMessage("No closed Pi session to reopen.");
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.focus", async () => {
			chat.reveal();
			await vscode.commands.executeCommand("setContext", "piChatFocus", true);
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.blur", async () => {
			await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
			await vscode.commands.executeCommand("setContext", "piChatFocus", false);
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.insertAtMention", async () => {
			await vscode.commands.executeCommand("workbench.view.extension.pi");
			chat.reveal();
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.openWalkthrough", async () => {
			await vscode.commands.executeCommand("workbench.action.openWalkthrough", {
				walkthroughID: "pi-code-walkthrough",
			});
		}),
	);

	// Plan mode CodeLens commands
	subs.push(
		vscode.commands.registerCommand("pi.acceptPlan", async (_uri?: vscode.Uri) => {
			const s = sessions.active;
			if (!s) {
				vscode.window.showWarningMessage("No active Pi session.");
				return;
			}
			chat.reveal();
			await s.prompt("I accept this plan. Please proceed with the implementation.");
		}),
	);

	subs.push(
		vscode.commands.registerCommand("pi.revisePlan", async (_uri?: vscode.Uri) => {
			const s = sessions.active;
			if (!s) {
				vscode.window.showWarningMessage("No active Pi session.");
				return;
			}
			const feedback = await vscode.window.showInputBox({
				title: "Revise Plan",
				placeHolder: "Tell Pi what to do instead...",
				prompt: "Your feedback will be sent to the active session.",
			});
			if (!feedback) return;
			chat.reveal();
			await s.prompt(`Instead of the proposed plan, please do this: ${feedback}`);
		}),
	);

	return subs;
}
