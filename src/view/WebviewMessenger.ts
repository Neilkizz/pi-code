import type * as vscode from "vscode";
import type * as T from "../rpc/types";

// ---------------------------------------------------------------------------
// Extension → Webview messages (events/push)
// ---------------------------------------------------------------------------

export interface StateSnapshotMessage {
	kind: "stateSnapshot";
	sessionId: string;
	sessionName?: string;
	model?: T.ModelInfo | null;
	thinkingLevel: T.ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	messageCount?: number;
}

export interface PiEventMessage {
	kind: "piEvent";
	sessionId: string;
	event: T.PiEvent;
}

export interface ModelListMessage {
	kind: "modelList";
	models: T.ModelInfo[];
}

export interface HistoryMessage {
	kind: "history";
	sessionId: string;
	messages: T.AgentMessage[];
}

/**
 * Workspace file suggestions for @-mention autocomplete.
 * Includes both workspace files (via findFiles) and open editor tabs.
 */
export interface FileSuggestionsMessage {
	kind: "fileSuggestions";
	files: { path: string; isFile: boolean }[];
}

/** Context item shown to the user before sending a prompt. */
export interface ContextItem {
	type: "file" | "selection" | "diagnostic" | "git";
	path?: string;
	label: string;
	detail?: string;
	removable: boolean;
	id: string;
}

/** Push current context items to the webview (F-113/114). */
export interface ContextUpdateMessage {
	kind: "contextUpdate";
	items: ContextItem[];
}

/** Git status display info (F-110). */
export interface GitStatusMessage {
	kind: "gitStatus";
	branch: string;
	modified: number;
	added: number;
	deleted: number;
	ahead: number;
	behind: number;
}

/** Change summary after a turn completes (F-414). */
export interface ChangeSummaryMessage {
	kind: "changeSummary";
	summary: string;
}

export type HostToWebview =
	| StateSnapshotMessage
	| PiEventMessage
	| ModelListMessage
	| HistoryMessage
	| FileSuggestionsMessage
	| ContextUpdateMessage
	| GitStatusMessage
	| ChangeSummaryMessage;

// ---------------------------------------------------------------------------
// Webview → Host messages (user actions)
// ---------------------------------------------------------------------------

export interface PromptMessage {
	kind: "prompt";
	text: string;
	images?: T.ImageContent[];
}

export interface SteerMessage {
	kind: "steer";
	text: string;
}

export interface AbortMessage {
	kind: "abort";
}

export interface ModelPickMessage {
	kind: "setModel";
	provider: string;
	modelId: string;
}

export interface CycleModelMessage {
	kind: "cycleModel";
	/** Cycle direction — "next" (default) or "prev". */
	direction?: "next" | "prev";
}

export interface SetThinkingLevelMessage {
	kind: "setThinkingLevel";
	level: T.ThinkingLevel;
}

export interface LoginMessage {
	kind: "login";
}

export interface LogoutMessage {
	kind: "logout";
}

export interface AcceptDiffMessage {
	kind: "acceptDiff";
	diffId?: string;
}

export interface RejectDiffMessage {
	kind: "rejectDiff";
	diffId?: string;
}

/** Request workspace file suggestions. The host pushes a FileSuggestionsMessage in reply. */
export interface RequestFileSuggestionsMessage {
	kind: "requestFileSuggestions";
}

/** Remove a context item by its id (F-114). */
export interface RemoveContextItemMessage {
	kind: "removeContextItem";
	id: string;
}

export type WebviewToHost =
	| PromptMessage
	| SteerMessage
	| AbortMessage
	| ModelPickMessage
	| CycleModelMessage
	| SetThinkingLevelMessage
	| LoginMessage
	| LogoutMessage
	| AcceptDiffMessage
	| RejectDiffMessage
	| RequestFileSuggestionsMessage
	| RemoveContextItemMessage;

// ---------------------------------------------------------------------------
// Helper: send typed message to a webview.
// ---------------------------------------------------------------------------

export function postToWebview(
	webview: vscode.Webview,
	msg: HostToWebview,
): void {
	void webview.postMessage(msg);
}

/**
 * Decode and validate an incoming message from the webview.
 * Returns null if the message is malformed or from an untrusted origin.
 */
export function decodeFromWebview(data: unknown): WebviewToHost | null {
	if (!data || typeof data !== "object") return null;
	const d = data as Record<string, unknown>;
	// Require a valid `kind` discriminator — arbitrary objects are rejected.
	if (typeof d.kind !== "string") return null;
	const validKinds = new Set([
		"prompt",
		"steer",
		"abort",
		"setModel",
		"cycleModel",
		"setThinkingLevel",
		"login",
		"logout",
		"acceptDiff",
		"rejectDiff",
		"requestFileSuggestions",
		"removeContextItem",
	]);
	if (!validKinds.has(d.kind)) return null;
	return data as WebviewToHost;
}
