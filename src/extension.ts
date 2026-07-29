import * as vscode from "vscode";
import { Configuration } from "./settings/Configuration";
import { registerCommands } from "./settings/Commands";
import type { ExtensionContext } from "./types/ExtensionContext";
import { makeLogger } from "./types/ExtensionContext";
import { SessionManager } from "./session/SessionManager";
import { ChatProvider } from "./view/ChatProvider";
import { AuthService } from "./auth/AuthService";
import { DiffController } from "./diff/DiffController";
import { PiTerminal } from "./terminal/PiTerminal";
import { SessionTreeDataProvider } from "./view/SessionTreeProvider";
import { registerPlanProvider } from "./view/PlanContentProvider";

let disposables: vscode.Disposable[] = [];

/**
 * Workspace Trust handler (S-003).
 * When the workspace is NOT trusted, sets a context key so commands/sessions
 * can degrade to read-only mode. Also shows a one-time warning.
 */
function handleWorkspaceTrust(ctx: ExtensionContext): vscode.Disposable {
	const update = () => {
		const trusted = vscode.workspace.isTrusted;
		void vscode.commands.executeCommand(
			"setContext",
			"pi.workspaceTrusted",
			trusted,
		);
		if (!trusted) {
			ctx.log(
				"warn",
				"Workspace is NOT trusted — Pi Code running in read-only mode",
			);
			void vscode.window.showWarningMessage(
				"Pi Code: Workspace is not trusted. " +
					"Running in read-only mode — file edits and commands are disabled.",
			);
		}
	};
	// Check immediately and on changes.
	update();
	return vscode.workspace.onDidGrantWorkspaceTrust(update);
}

export async function activate(
	context: vscode.ExtensionContext,
): Promise<void> {
	const config = new Configuration();
	const { log, showOutputChannel } = makeLogger("pi-code");
	const ctx: ExtensionContext = {
		vscodeContext: context,
		config,
		log,
		showOutputChannel,
	};

	// Initialize workspace trust handling (S-003).
	context.subscriptions.push(handleWorkspaceTrust(ctx));

	const sessions = new SessionManager(ctx);
	const diff = new DiffController(ctx, sessions);
	const auth = new AuthService(ctx, sessions);
	const chat = new ChatProvider(ctx, sessions, diff);
	const terminal = new PiTerminal(ctx, sessions);

	// Restore persistent sessions from a previous VS Code window.
	void sessions.restoreSaved();

	// Register the session list tree view.
	const sessionTree = new SessionTreeDataProvider(sessions);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider("piSessions", sessionTree),
	);

	// Register the webview view provider.
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatProvider.viewId, chat, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	// Register the plan virtual document provider + CodeLens.
	registerPlanProvider(ctx);

	// Register all commands (includes PiTerminal for toggleTerminal).
	disposables.push(
		...registerCommands(ctx, sessions, chat, auth, diff, terminal),
	);

	context.subscriptions.push(
		config,
		sessions,
		diff,
		auth,
		chat,
		terminal,
		sessionTree,
		...disposables,
	);

	log("info", "Pi Code extension activated");
}

export function deactivate(): void {
	for (const d of disposables) {
		try {
			d.dispose();
		} catch {
			/* ignore */
		}
	}
	disposables = [];
}
