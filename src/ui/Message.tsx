import React from "react";
import type { DisplayMessage } from "./App";

interface Props {
	msg: DisplayMessage;
}

export function MessageItem({ msg }: Props) {
	if (msg.kind === "compaction") {
		return <div className="compaction-banner">{msg.text}</div>;
	}

	if (msg.kind === "tool" || msg.kind === "tool-end") {
		return <ToolCallBlock msg={msg} />;
	}

	const streamingClass = msg.isStreaming ? " streaming" : "";

	return (
		<div className={`message ${msg.kind}${streamingClass}`}>
			{msg.kind === "assistant" && msg.thinkingText && (
				<ThinkingBlock text={msg.thinkingText} />
			)}
			<div className="message-content">
				{msg.text
					? formatCodeBlocks(msg.text)
					: msg.isStreaming
						? <span style={{ opacity: 0.5 }}>▊</span>
						: ""}
			</div>
		</div>
	);
}

/** Collapsible thinking/reasoning block matching Claude Code bullet style: "● Thinking". */
function ThinkingBlock({ text }: { text: string }) {
	const [expanded, setExpanded] = React.useState(false);
	if (!text.trim()) return null;
	return (
		<div className="thinking-block">
			<div className="thinking-toggle" onClick={() => setExpanded((v) => !v)}>
				<span className="bullet-dot grey">●</span>
				<span className="thinking-toggle-text">Thinking</span>
				<span className="thinking-toggle-arrow">{expanded ? "▾" : "▸"}</span>
			</div>
			{expanded && <div className="thinking-content">{text}</div>}
		</div>
	);
}

/** Tool call block matching Claude Code bullet style: "● Bash Build VSIX" with IN / OUT blocks. */
function ToolCallBlock({ msg }: { msg: DisplayMessage }) {
	const [expanded, setExpanded] = React.useState(true);
	const statusDot = msg.toolStatus === "running" ? "blue" : msg.toolStatus === "done" ? "green" : "red";

	let inText = "";
	let outText = "";
	if (msg.text) {
		if (msg.text.startsWith("args: ")) {
			inText = msg.text.replace(/^args:\s*/, "");
		} else {
			outText = msg.text;
		}
	}

	return (
		<div className="tool-call">
			<div className="tool-call-header" onClick={() => setExpanded((v) => !v)}>
				<span className={`bullet-dot ${statusDot}`}>●</span>
				<span className="tool-call-name">{msg.toolName || "Tool"}</span>
				{msg.toolStatus === "running" && <span className="tool-running-spinner">…</span>}
				<span className="tool-toggle-arrow">{expanded ? "▾" : "▸"}</span>
			</div>
			{expanded && (inText || outText) && (
				<div className="tool-call-body">
					{inText && (
						<div className="tool-io-block">
							<span className="io-badge in">IN</span>
							<pre className="io-code">{inText}</pre>
						</div>
					)}
					{outText && (
						<div className="tool-io-block">
							<span className="io-badge out">OUT</span>
							<pre className="io-code">{outText}</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** Full Markdown rendering: fenced code blocks + inline markdown. */
function formatCodeBlocks(text: string): React.ReactNode {
	const parts = text.split(/(```[\s\S]*?```)/g);
	return parts.map((part, i) => {
		if (part.startsWith("```") && part.endsWith("```")) {
			const content = part.slice(3, -3);
			const firstLineBreak = content.indexOf("\n");
			const lang = firstLineBreak > 0 ? content.slice(0, firstLineBreak) : "";
			const code = firstLineBreak > 0 ? content.slice(firstLineBreak + 1) : content;
			return (
				<pre key={i} className="code-block">
					<div className="code-header">
						<span>{lang || "code"}</span>
					</div>
					<div className="code-body">
						<code>{code}</code>
					</div>
				</pre>
			);
		}
		return <InlineMarkdown key={i} text={part} />;
	});
}

function InlineMarkdown({ text }: { text: string }) {
	const lines = text.split("\n");
	const elements: React.ReactNode[] = [];
	let inList: React.ReactNode[] | null = null;
	let listKey = 0;

	const flushList = () => {
		if (inList !== null) {
			elements.push(
				<ul key={listKey++} className="md-list">
					{inList}
				</ul>,
			);
			inList = null;
		}
	};

	lines.forEach((line, li) => {
		const bqMatch = line.match(/^ {0,3}>\s?(.*)$/);
		if (bqMatch) {
			flushList();
			elements.push(
				<blockquote key={li} className="md-blockquote">
					<InlineMarkdownInline text={bqMatch[1]} />
				</blockquote>,
			);
			return;
		}

		const ulMatch = line.match(/^ {0,3}([-*+])\s(.*)$/);
		if (ulMatch) {
			if (inList === null) inList = [];
			inList.push(
				<li key={`li-${li}`}>
					<span className="bullet-dot grey">●</span>{" "}
					<InlineMarkdownInline text={ulMatch[2]} />
				</li>,
			);
			return;
		}

		const olMatch = line.match(/^ {0,3}(\d+)\.\s(.*)$/);
		if (olMatch) {
			if (inList === null) inList = [];
			inList.push(
				<li key={`li-${li}`}>
					<InlineMarkdownInline text={olMatch[2]} />
				</li>,
			);
			return;
		}

		flushList();

		const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (hMatch) {
			const level = hMatch[1].length;
			const Tag = `h${Math.min(level + 1, 6)}` as keyof JSX.IntrinsicElements;
			elements.push(
				<Tag key={li} className={`md-heading md-h${level}`}>
					<InlineMarkdownInline text={hMatch[2]} />
				</Tag>,
			);
			return;
		}

		if (/^ {0,3}([-*_]){3,}\s*$/.test(line)) {
			elements.push(<hr key={li} className="md-hr" />);
			return;
		}

		if (line.trim() === "") {
			elements.push(<br key={li} />);
			return;
		}

		elements.push(
			<p key={li} className="md-p">
				<InlineMarkdownInline text={line} />
			</p>,
		);
	});

	flushList();
	return <>{elements}</>;
}

function InlineMarkdownInline({ text }: { text: string }): React.ReactNode {
	const parts = text.split(/(`[^`]+`)/g);
	return parts.map((part, i) => {
		if (part.startsWith("`") && part.endsWith("`")) {
			return <code key={i}>{part.slice(1, -1)}</code>;
		}
		const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
		return boldParts.map((bp, j) => {
			if (bp.startsWith("**") && bp.endsWith("**")) {
				return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
			}
			const italicParts = bp.split(/(\*[^*]+\*)/g);
			return italicParts.map((ip, k) => {
				if (ip.startsWith("*") && ip.endsWith("*") && ip.length > 1) {
					return <em key={`${i}-${j}-${k}`}>{ip.slice(1, -1)}</em>;
				}
				const linkParts = ip.split(/(\[[^\]]*\]\([^)]+\))/g);
				return linkParts.map((lp, m) => {
					const linkMatch = lp.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
					if (linkMatch) {
						return (
							<a key={`${i}-${j}-${k}-${m}`} href={linkMatch[2]} title={linkMatch[2]}>
								{linkMatch[1] || linkMatch[2]}
							</a>
						);
					}
					return lp;
				});
			});
		});
	});
}
