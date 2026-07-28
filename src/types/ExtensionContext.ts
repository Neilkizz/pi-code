import * as vscode from "vscode";
import type { Configuration } from "../settings/Configuration";
import { sanitizeLogMessage } from "../security/validation";

/**
 * Shared context object passed to every module so they don't each reach into
 * global vscode state. Keeps tests easy: construct a fake context and inject.
 */
export interface ExtensionContext {
	vscodeContext: vscode.ExtensionContext;
	config: Configuration;
	log: (level: "info" | "warn" | "error", msg: string) => void;
	/** Reveal the Pi Code output channel (for pi.showLogs). */
	showOutputChannel: () => void;
}

export function makeLogger(name = "pi-code"): {
	log: (level: "info" | "warn" | "error", msg: string) => void;
	showOutputChannel: () => void;
} {
	const channel = vscode.window.createOutputChannel(name);
	return {
		log: (level, msg) => {
			const line = `[${new Date().toISOString()}] [${level}] ${sanitizeLogMessage(msg)}`;
			channel.appendLine(line);
			if (level === "error") channel.show(true);
		},
		showOutputChannel: () => channel.show(true),
	};
}
