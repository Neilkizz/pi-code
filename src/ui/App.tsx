import React, { useCallback, useState } from "react";
import { HeaderBar, type SessionItem } from "./HeaderBar";
import { useVsCodeMessaging } from "./hooks";
import { MessageItem } from "./Message";
import { Toolbar } from "./Toolbar";
import { MentionsAutocomplete } from "./MentionsAutocomplete";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { ModesMenu, type PermissionMode, type EffortLevel } from "./ModesMenu";
import { ActionsMenu } from "./ActionsMenu";
import type { HostToWebview, WebviewToHost } from "../view/WebviewMessenger";
import type {
	PiEvent,
	AgentMessage,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	ToolExecutionEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolResultMessage,
} from "../rpc/types";

export interface DisplayMessage {
	id: string;
	kind: "user" | "assistant" | "tool" | "tool-end" | "compaction";
	text: string;
	thinkingText?: string;
	toolName?: string;
	toolCallId?: string;
	toolStatus?: string;
	isStreaming?: boolean;
	message?: AgentMessage;
}

export function reduceMessages(prev: DisplayMessage[], event: PiEvent): DisplayMessage[] {
	const next = prev.slice();
	switch (event.type) {
		case "message_start": {
			const e = event as MessageStartEvent;
			if (e.message.role === "user") {
				next.push({ id: `msg-${Date.now()}`, kind: "user", text: textFromMsg(e.message) });
			}
			if (e.message.role === "assistant") {
				next.push({ id: `msg-${Date.now()}`, kind: "assistant", text: "", message: e.message, isStreaming: true });
			}
			break;
		}
		case "message_update": {
			const e = event as MessageUpdateEvent;
			const last = next[next.length - 1];
			if (!last || !last.isStreaming) break;
			switch (e.assistantMessageEvent.type) {
				case "text_delta": last.text += e.assistantMessageEvent.delta; break;
				case "thinking_delta": last.thinkingText = (last.thinkingText ?? "") + e.assistantMessageEvent.delta; break;
			}
			break;
		}
		case "message_end": {
			for (let i = next.length - 1; i >= 0; i--) {
				if (next[i].isStreaming) { next[i] = { ...next[i], isStreaming: false }; break; }
			}
			break;
		}
		case "tool_execution_start": {
			const e = event as ToolExecutionStartEvent;
			next.push({ id: `tool-${e.toolCallId}`, kind: "tool", text: `args: ${JSON.stringify(e.args, null, 2)}`, toolName: e.toolName, toolCallId: e.toolCallId, toolStatus: "running" });
			break;
		}
		case "tool_execution_update": {
			const e = event as ToolExecutionUpdateEvent;
			for (let i = next.length - 1; i >= 0; i--) {
				const m = next[i];
				if (m.kind === "tool" && m.toolCallId === e.toolCallId && m.toolStatus === "running") {
					next[i] = { ...m, text: textFromResult(e.partialResult), isStreaming: true };
					break;
				}
			}
			break;
		}
		case "tool_execution_end": {
			const e = event as ToolExecutionEndEvent;
			for (let i = next.length - 1; i >= 0; i--) {
				const m = next[i];
				if (m.kind === "tool" && m.toolCallId === e.toolCallId && m.toolStatus === "running") {
					next[i] = { ...m, kind: "tool-end", text: textFromResult(e.result), toolStatus: e.isError ? "error" : "done", isStreaming: false };
					break;
				}
			}
			break;
		}
		case "compaction_start": case "compaction_end":
			next.push({ id: `comp-${Date.now()}`, kind: "compaction", text: event.type === "compaction_start" ? "Context compacting…" : "Context compacted" });
			break;
	}
	for (const msg of next) {
		if (msg.text && msg.text.length > 50000) msg.text = msg.text.slice(0, 50000) + "\n\n[...truncated at 50K chars]";
		if (msg.thinkingText && msg.thinkingText.length > 50000) msg.thinkingText = msg.thinkingText.slice(0, 50000) + "\n\n[...truncated]";
	}
	if (next.length > 200) next.splice(0, next.length - 200);
	return next;
}

export function textFromMsg(msg: AgentMessage): string {
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) return msg.content.map((c: any) => c.text ?? "").join("\n");
	return "";
}

export function textFromResult(pr: any): string {
	if (!pr) return "";
	if (typeof pr === "string") return pr;
	if (Array.isArray(pr.content)) return pr.content.map((c: any) => c.text ?? "").join("\n");
	return JSON.stringify(pr, null, 2);
}

export function convertAgentMessages(messages: AgentMessage[]): DisplayMessage[] {
	const next: DisplayMessage[] = [];
	messages.forEach((message, messageIndex) => {
		if (message.role === "user") {
			next.push({ id: `msg-user-${messageIndex}`, kind: "user", text: textFromMsg(message) });
		} else if (message.role === "assistant") {
			let currentAssistant: DisplayMessage | null = null;
			const content = Array.isArray(message.content) ? message.content : [];
			content.forEach((block: any, bi: number) => {
				if (block.type === "text" || block.type === "thinking") {
					if (!currentAssistant) currentAssistant = { id: `msg-assistant-${messageIndex}-${bi}`, kind: "assistant", text: "", thinkingText: "" };
					if (block.type === "text") currentAssistant.text += block.text ?? "";
					else currentAssistant.thinkingText += block.text ?? "";
				} else if (block.type === "toolCall") {
					if (currentAssistant) { next.push(currentAssistant); currentAssistant = null; }
					next.push({ id: `tool-${block.toolCallId}`, kind: "tool", text: `args: ${JSON.stringify(block.args, null, 2)}`, toolName: block.name || block.toolName, toolCallId: block.toolCallId, toolStatus: "running" });
				}
			});
			if (currentAssistant) next.push(currentAssistant);
		} else if (message.role === "toolResult") {
			const msg = message as ToolResultMessage;
			const idx = next.findIndex((m) => m.toolCallId === msg.toolCallId);
			if (idx !== -1) next[idx] = { ...next[idx], kind: "tool-end", text: textFromResult(msg), toolStatus: msg.isError ? "error" : "done" };
			else next.push({ id: `tool-${msg.toolCallId}`, kind: "tool-end", text: textFromResult(msg), toolName: msg.toolName, toolCallId: msg.toolCallId, toolStatus: msg.isError ? "error" : "done" });
		} else if (message.role === "compactionSummary") {
			next.push({ id: `comp-${messageIndex}`, kind: "compaction", text: "Context compacted" });
		} else if (message.role === "branchSummary") {
			next.push({ id: `comp-${messageIndex}`, kind: "compaction", text: "Session branched" });
		}
	});
	return next;
}

export function formatSelectionBadge(lineCount: number, visible: boolean): string {
	if (lineCount <= 0 || !visible) return "";
	return `${lineCount} ${lineCount === 1 ? "line" : "lines"} selected`;
}

export function App() {
	const [_activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const activeSessionIdRef = React.useRef<string | null>(null);
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [model, setModel] = useState<string>("");
	const [thinking, setThinking] = useState<string>("medium");
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [contextItems, setContextItems] = useState<string[]>([]);
	const [gitBranch, setGitBranch] = useState<string>("");
	const [gitChanges, setGitChanges] = useState<string>("");
	const [changeSummary, setChangeSummary] = useState<string>("");
	const [sessionNameState, setSessionNameState] = useState<string>("");
	const [sessions, setSessions] = useState<SessionItem[]>([]);

	const onHostMessage = useCallback((msg: HostToWebview) => {
		switch (msg.kind) {
			case "piEvent":
				if (msg.sessionId === activeSessionIdRef.current) setMessages((prev) => reduceMessages(prev, msg.event));
				break;
			case "stateSnapshot": {
				const isNew = msg.sessionId !== activeSessionIdRef.current;
				if (isNew) { activeSessionIdRef.current = msg.sessionId; setActiveSessionId(msg.sessionId); setMessages([]); }
				setModel(msg.model ? `${msg.model.provider}/${msg.model.id}` : "—");
				setThinking(msg.thinkingLevel);
				setIsStreaming(msg.isStreaming);
				break;
			}
			case "history":
				if (msg.sessionId === activeSessionIdRef.current) setMessages(convertAgentMessages(msg.messages));
				break;
			case "fileSuggestions": setSuggestions(msg.files.map((f) => f.path)); break;
			case "modelList": setSuggestions(msg.models.map((m) => `${m.provider}/${m.id}`)); break;
			case "contextUpdate": setContextItems(msg.items.map((i) => i.label)); break;
			case "gitStatus": setGitBranch(msg.branch); setGitChanges(`+${msg.added}/-${msg.deleted} ~${msg.modified}`); break;
			case "changeSummary": setChangeSummary(msg.summary); break;
		}
	}, []);

	const post = useVsCodeMessaging(onHostMessage);
	const scrollRef = React.useRef<HTMLDivElement>(null);

	const handleSelectSession = (id: string) => {
		setActiveSessionId(id);
		activeSessionIdRef.current = id;
		setMessages([]);
		post({ kind: "selectSession", sessionId: id } as any);
	};

	const handleNewSession = () => {
		post({ kind: "newSession" } as any);
	};
	React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

	const handleSend = (text: string) => {
		if (!text.trim()) return;
		const expandedText = text.replace(/@(\S+?)#(?:L)?(\d+)(?:-(\d+))?/g, (_m, fp, s, e) => `[${fp}:${s}-${e ?? s}]`);
		const dirRefText = expandedText.replace(/@(\S+?\/)/g, (_m, dp) => `[directory: ${dp}]`);
		const isImage = dirRefText.startsWith("data:image");
		const images = isImage ? [{ type: "image" as const, data: dirRefText.replace(/^data:image\/\w+;base64,/, ""), mimeType: "image/png" }] : undefined;
		post(images ? { kind: "prompt", text: "What's in this image?", images } : { kind: "prompt", text: dirRefText });
	};

	const handlePlanAction = (action: "accept" | "revise", feedback?: string) => {
		if (action === "accept") {
			post({ kind: "prompt", text: "I accept this plan. Please proceed with the implementation." });
		} else if (action === "revise" && feedback) {
			post({ kind: "prompt", text: `Instead of the proposed plan, please do this: ${feedback}` });
		}
	};

	return (
		<div className="chat-container">
			<HeaderBar
				sessionName={sessionNameState}
				model={model}
				gitBranch={gitBranch}
				gitChanges={gitChanges}
				sessions={sessions}
				activeSessionId={_activeSessionId}
				onSelectSession={handleSelectSession}
				onNewSession={handleNewSession}
			/>
			<Toolbar model={model} thinking={thinking} isStreaming={isStreaming}
				onAbort={() => post({ kind: "abort" })}
				onCycleModel={(dir) => post({ kind: "cycleModel", direction: dir })}
				onSetThinking={(level) => post({ kind: "setThinkingLevel", level })}
				gitBranch={gitBranch} gitChanges={gitChanges} />
			{messages.length === 0 && !isStreaming ? (
				<WelcomeScreen onSend={handleSend} />
			) : (
				<div className="message-list" ref={scrollRef}>
					{messages.map((m) => (<MessageItem key={m.id} msg={m} onPlanAction={handlePlanAction} />))}
				</div>
			)}
			{contextItems.length > 0 && (
				<div className="context-panel">
					<div className="context-header">Context ({contextItems.length})</div>
					{contextItems.map((item, i) => (
						<div key={i} className="context-item">
							<span>📄 {item}</span>
							<button className="remove-btn" onClick={() => post({ kind: "removeContextItem", id: `ctx-${i}` })}>×</button>
						</div>
					))}
				</div>
			)}
			{changeSummary && (
				<div className="change-summary">
					<div className="change-summary-title">Changes made</div>
					<div className="change-summary-file">{changeSummary}</div>
				</div>
			)}
			<InputArea
				onSend={handleSend}
				disabled={isStreaming}
				suggestions={suggestions}
				model={model}
				onCycleModel={(dir) => post({ kind: "cycleModel", direction: dir })}
				onAbort={() => post({ kind: "abort" })}
			/>
		</div>
	);
}

function WelcomeScreen({ onSend }: { onSend: (t: string) => void }) {
	const items = [
		{ text: "Explain this project", prompt: "Explain the architecture and structure of this project in detail." },
		{ text: "Find bugs", prompt: "Review the open files for potential bugs, edge cases, and code quality issues." },
		{ text: "Write tests", prompt: "Analyze the code in the current file and write comprehensive unit tests." },
		{ text: "Refactor", prompt: "Review the current file and suggest concrete refactoring improvements." },
	];
	return (
		<div className="welcome">
			<div className="welcome-branding">
				<div className="welcome-logo">π</div>
				<h1 className="welcome-title">Pi Code</h1>
				<p className="welcome-subtitle">Your AI coding partner in VS Code</p>
			</div>
			<div className="welcome-actions">
				{items.map((item) => (
					<button key={item.text} className="welcome-action-btn" onClick={() => onSend(item.prompt)}>
						<span className="welcome-action-icon">{item.text[0]}</span>
						<span>{item.text}</span>
					</button>
				))}
			</div>
			<div className="welcome-shortcuts">
				<div className="shortcut-row"><kbd>Cmd+Escape</kbd><span className="desc">Toggle chat focus</span></div>
				<div className="shortcut-row"><kbd>Cmd+Shift+Escape</kbd><span className="desc">Open Pi Code</span></div>
				<div className="shortcut-row"><kbd>Alt+K</kbd><span className="desc">Insert @-mention</span></div>
				<div className="shortcut-row"><kbd>Cmd+N</kbd><span className="desc">New conversation</span></div>
			</div>
		</div>
	);
}

interface AttachedFile {
	name: string;
	isImage: boolean;
	size?: string;
}

function InputArea({
	onSend,
	disabled,
	suggestions,
	model,
	onCycleModel,
	onAbort,
}: {
	onSend: (t: string) => void;
	disabled: boolean;
	suggestions: string[];
	model: string;
	onCycleModel: (dir: "next" | "prev") => void;
	onAbort: () => void;
}) {
	const [text, setText] = React.useState("");
	const [showMentions, setShowMentions] = React.useState(false);
	const [mentionFilter, setMentionFilter] = React.useState("");
	const [showSlash, setShowSlash] = React.useState(false);
	const [slashFilter, setSlashFilter] = React.useState("");

	// Claude Code UI states
	const [mode, setMode] = React.useState<PermissionMode>("auto");
	const [effort, setEffort] = React.useState<EffortLevel>("max");
	const [thinkingEnabled, setThinkingEnabled] = React.useState(true);
	const [flaggedSwitch, setFlaggedSwitch] = React.useState(true);
	const [showModesMenu, setShowModesMenu] = React.useState(false);
	const [showActionsMenu, setShowActionsMenu] = React.useState(false);
	const [attachedFiles, setAttachedFiles] = React.useState<AttachedFile[]>([]);
	const [selectedLineCount, setSelectedLineCount] = React.useState(0);
	const [selectionVisible, setSelectionVisible] = React.useState(true);

	const inputRef = React.useRef<HTMLTextAreaElement>(null);

	const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value;
		setText(val);
		const cursor = e.target.selectionStart;
		const beforeCursor = val.slice(0, cursor);
		const slashMatch = beforeCursor.match(/(?:^|\s)\/(\S*)$/);
		if (slashMatch) {
			setSlashFilter(slashMatch[1]);
			setShowSlash(true);
			setShowMentions(false);
			return;
		}
		setShowSlash(false);
		const atMatch = beforeCursor.match(/@(\S*)$/);
		if (atMatch) {
			setMentionFilter(atMatch[1]);
			setShowMentions(true);
		} else setShowMentions(false);
	};

	const handleSend = () => {
		if ((text.trim() || attachedFiles.length > 0) && !disabled) {
			onSend(text);
			setText("");
			setShowMentions(false);
			setShowSlash(false);
			setAttachedFiles([]);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey && !showMentions && !showSlash && !showModesMenu && !showActionsMenu) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		const files = Array.from(e.dataTransfer.files);
		if (files.length > 0) {
			const file = files[0];
			const isImg = file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
			setAttachedFiles((prev) => [
				...prev,
				{
					name: file.name,
					isImage: isImg,
					size: isImg ? "872×1512" : `${Math.round(file.size / 1024)}KB`,
				},
			]);
		} else if (e.dataTransfer.types.includes("text/uri-list")) {
			const uri = e.dataTransfer.getData("text/uri-list");
			if (uri) {
				const name = uri.split("/").pop() || uri;
				setAttachedFiles((prev) => [...prev, { name, isImage: false }]);
			}
		}
		inputRef.current?.focus();
	};

	const removeFile = (idx: number) => {
		setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
	};

	const insertMention = (value: string) => {
		const cursor = inputRef.current?.selectionStart ?? text.length;
		const atIdx = text.slice(0, cursor).lastIndexOf("@");
		setText(text.slice(0, atIdx) + `@${value} ` + text.slice(cursor));
		setShowMentions(false);
		inputRef.current?.focus();
	};

	const insertSlash = (cmd: string) => {
		const cursor = inputRef.current?.selectionStart ?? text.length;
		const slashIdx = text.slice(0, cursor).lastIndexOf("/");
		setText(text.slice(0, slashIdx) + `${cmd} ` + text.slice(cursor));
		setShowSlash(false);
		if (["/login", "/logout", "/quit", "/compact", "/reload"].includes(cmd)) onSend(cmd);
		else inputRef.current?.focus();
	};

	const handleAction = (action: string) => {
		if (action === "attach" || action === "mention") {
			const cursor = inputRef.current?.selectionStart ?? text.length;
			setText(text.slice(0, cursor) + "@" + text.slice(cursor));
			inputRef.current?.focus();
		} else if (action === "clear") {
			onSend("/compact");
		} else if (action === "rewind") {
			onSend("/tree");
		} else if (action === "switchModel") {
			onCycleModel("next");
		}
	};

	const getModeIcon = (m: PermissionMode) => {
		switch (m) {
			case "manual": return "✋";
			case "edit": return "</>";
			case "plan": return "📑";
			case "auto": return "⚡";
			case "bypass": return "⇄";
		}
	};

	const getModeLabel = (m: PermissionMode) => {
		switch (m) {
			case "manual": return "Manual";
			case "edit": return "Edit automatically";
			case "plan": return "Plan";
			case "auto": return "Auto";
			case "bypass": return "Bypass";
		}
	};

	return (
		<div className="input-area" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={handleDrop}>
			{showMentions && (
				<MentionsAutocomplete
					filter={mentionFilter}
					suggestions={suggestions}
					onPick={insertMention}
					onClose={() => setShowMentions(false)}
				/>
			)}
			{showSlash && (
				<SlashCommandMenu
					filter={slashFilter}
					onPick={insertSlash}
					onClose={() => setShowSlash(false)}
				/>
			)}

			{/* Claude Code Rounded Prompt Card */}
			<div className={`claude-input-card ${disabled ? "disabled" : ""}`}>
				{/* Modes Menu Popup */}
				{showModesMenu && (
					<ModesMenu
						currentMode={mode}
						currentEffort={effort}
						onSelectMode={setMode}
						onSelectEffort={setEffort}
						onClose={() => setShowModesMenu(false)}
					/>
				)}

				{/* Actions Menu Popup */}
				{showActionsMenu && (
					<ActionsMenu
						currentModel={model}
						currentEffort={effort}
						thinkingEnabled={thinkingEnabled}
						flaggedModelSwitch={flaggedSwitch}
						onSelectAction={handleAction}
						onToggleThinking={() => setThinkingEnabled(!thinkingEnabled)}
						onToggleFlaggedSwitch={() => setFlaggedSwitch(!flaggedSwitch)}
						onSelectEffort={setEffort}
						onClose={() => setShowActionsMenu(false)}
					/>
				)}

				{/* Attached Files Badges & Selection Badge */}
				{(attachedFiles.length > 0 || (selectedLineCount > 0 && selectionVisible)) && (
					<div className="attached-files-row">
						{attachedFiles.map((file, i) => (
							<div key={i} className="attached-file-badge">
								<span className="file-icon">{file.isImage ? "📷" : "📄"}</span>
								<span className="file-name">{file.name}</span>
								{file.size && <span className="file-size">{file.size}</span>}
								<button className="remove-badge-btn" onClick={() => removeFile(i)}>
									×
								</button>
							</div>
						))}
						{selectedLineCount > 0 && selectionVisible && (
							<div className="attached-file-badge selection-badge">
								<span className="file-icon">📄</span>
								<span className="file-name">{selectedLineCount} {selectedLineCount === 1 ? "line" : "lines"} selected</span>
								<button
									type="button"
									className="remove-badge-btn"
									onClick={() => setSelectionVisible(false)}
									title="Hide selection context"
								>
									👁
								</button>
							</div>
						)}
					</div>
				)}

				{/* Textarea */}
				<textarea
					ref={inputRef}
					value={text}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					placeholder={disabled ? "Claude is thinking…" : "Ask Claude a question or type / for commands..."}
					rows={2}
					disabled={disabled}
				/>

				{/* Bottom Toolbar Row inside card */}
				<div className="card-toolbar-row">
					<div className="card-toolbar-left">
						<button
							type="button"
							className="card-icon-btn"
							title="Add context & actions"
							onClick={() => {
								setShowActionsMenu(!showActionsMenu);
								setShowModesMenu(false);
							}}
						>
							+
						</button>
						<button
							type="button"
							className="card-icon-btn"
							title="Mention file or prompt template"
							onClick={() => {
								const cursor = inputRef.current?.selectionStart ?? text.length;
								setText(text.slice(0, cursor) + "@" + text.slice(cursor));
								inputRef.current?.focus();
							}}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
								<line x1="9" y1="3" x2="9" y2="21" />
							</svg>
						</button>
					</div>

					<div className="card-toolbar-right">
						{/* Mode Selector Pill */}
						<button
							type="button"
							className="mode-pill-btn"
							onClick={() => {
								setShowModesMenu(!showModesMenu);
								setShowActionsMenu(false);
							}}
						>
							<span className="mode-pill-icon">{getModeIcon(mode)}</span>
							<span className="mode-pill-label">{getModeLabel(mode)}</span>
						</button>

						{/* Terracotta Up-Arrow Submit Button */}
						{disabled ? (
							<button
								type="button"
								className="submit-square-btn stop"
								onClick={onAbort}
								title="Stop response"
							>
								■
							</button>
						) : (
							<button
								type="button"
								className={`submit-square-btn ${!text.trim() && attachedFiles.length === 0 ? "inactive" : ""}`}
								onClick={handleSend}
								disabled={!text.trim() && attachedFiles.length === 0}
								title="Send prompt"
							>
								↑
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
