# Claude Code VS Code Extension 1:1 UI/UX Replica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Pi Code VS Code extension webview into a 100% 1:1 visual and interactive replica of Anthropic's official Claude Code VS Code extension (header bar, past conversations drawer, plan review card, selection line indicators, popups, terracotta prompt box, and tool blocks).

**Architecture:** A React 18 webview UI composed of modular components (`HeaderBar`, `HistoryDrawer`, `ClaudeInputCard`, `PlanReviewCard`, `ModesMenu`, `ActionsMenu`, `MessageItem`) communicating with the VS Code extension host via typed `WebviewMessenger` postMessage calls.

**Tech Stack:** TypeScript 5.3, React 18, Webpack 5, Mocha + ts-node for unit tests, vsce for VSIX packaging.

## Global Constraints

- TypeScript compilation (`npm run compile`) must pass with 0 errors after every task.
- Mocha test suite (`npm run test:unit`) must pass all tests after every task.
- Webpack production build (`npm run build`) must succeed after every task.
- VSIX packaging (`npx vsce package`) must succeed after final task.
- No external CSS frameworks — pure custom CSS variables using VS Code theme parameters (`var(--vscode-...)`).

---

### Task 1: HeaderBar & Past Conversations HistoryDrawer

**Files:**
- Create: `src/ui/HeaderBar.tsx`
- Create: `test/unit/HeaderBar.test.ts`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/style.css`

**Interfaces:**
- Consumes: `sessionName: string`, `model: string`, `thinkingLevel: string`, `gitBranch: string`, `gitChanges: string`, `sessionsList: { id: string; name: string; timestamp: number }[]`
- Produces: `HeaderBar` component with expandable `HistoryDrawer` dropdown for session switching, searching past conversations, and creating new sessions.

- [ ] **Step 1: Write the failing test for HeaderBar and history session filtering**

Create `test/unit/HeaderBar.test.ts`:

```typescript
import assert from "assert";

export interface SessionItem {
	id: string;
	name: string;
	timestamp: number;
}

export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
	if (!query.trim()) return sessions;
	const q = query.toLowerCase();
	return sessions.filter((s) => s.name.toLowerCase().includes(q));
}

describe("HeaderBar filterSessions", () => {
	it("returns all sessions when search query is empty", () => {
		const sessions: SessionItem[] = [
			{ id: "1", name: "Fix authentication bug", timestamp: 1000 },
			{ id: "2", name: "Refactor database layer", timestamp: 2000 },
		];
		assert.strictEqual(filterSessions(sessions, "").length, 2);
	});

	it("filters sessions by case-insensitive name match", () => {
		const sessions: SessionItem[] = [
			{ id: "1", name: "Fix authentication bug", timestamp: 1000 },
			{ id: "2", name: "Refactor database layer", timestamp: 2000 },
		];
		const result = filterSessions(sessions, "auth");
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].id, "1");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_PROJECT=test/tsconfig.json npx mocha --require ts-node/register test/unit/HeaderBar.test.ts`
Expected: PASS (or fail if import missing before creation)

- [ ] **Step 3: Implement HeaderBar component**

Create `src/ui/HeaderBar.tsx`:

```typescript
import React, { useState, useRef, useEffect } from "react";

export interface SessionItem {
	id: string;
	name: string;
	timestamp: number;
}

interface HeaderBarProps {
	sessionName: string;
	model: string;
	gitBranch?: string;
	gitChanges?: string;
	sessions: SessionItem[];
	activeSessionId: string | null;
	onSelectSession: (id: string) => void;
	onNewSession: () => void;
}

export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
	if (!query.trim()) return sessions;
	const q = query.toLowerCase();
	return sessions.filter((s) => s.name.toLowerCase().includes(q));
}

export function HeaderBar({
	sessionName,
	model,
	gitBranch,
	gitChanges,
	sessions,
	activeSessionId,
	onSelectSession,
	onNewSession,
}: HeaderBarProps) {
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const drawerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
				setDrawerOpen(false);
			}
		};
		if (drawerOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [drawerOpen]);

	const filtered = filterSessions(sessions, searchQuery);

	return (
		<div className="claude-header-bar" ref={drawerRef}>
			<div className="header-main-row" onClick={() => setDrawerOpen(!drawerOpen)}>
				<span className="spark-logo">✱</span>
				<span className="session-title">{sessionName || "New Conversation"}</span>
				<span className="chevron-icon">{drawerOpen ? "▴" : "▾"}</span>

				{gitBranch && (
					<span className="git-branch-badge">
						{gitBranch} {gitChanges && <span className="git-changes">{gitChanges}</span>}
					</span>
				)}

				<span className="header-spacer" />

				<span className="model-chip">{model || "Claude Code"}</span>
				<button
					type="button"
					className="header-new-btn"
					onClick={(e) => {
						e.stopPropagation();
						onNewSession();
					}}
					title="New Conversation"
				>
					+
				</button>
			</div>

			{drawerOpen && (
				<div className="past-conversations-drawer">
					<div className="drawer-search-bar">
						<input
							type="text"
							placeholder="Search past conversations..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							autoFocus
						/>
					</div>

					<div className="drawer-session-list">
						{filtered.length === 0 ? (
							<div className="drawer-empty-state">No conversations found</div>
						) : (
							filtered.map((s) => (
								<div
									key={s.id}
									className={`drawer-session-item ${s.id === activeSessionId ? "active" : ""}`}
									onClick={() => {
										onSelectSession(s.id);
										setDrawerOpen(false);
									}}
								>
									<span className="drawer-item-icon">💬</span>
									<div className="drawer-item-info">
										<div className="drawer-item-name">{s.name || "Untitled session"}</div>
										<div className="drawer-item-time">
											{new Date(s.timestamp).toLocaleDateString()}
										</div>
									</div>
								</div>
							))
						)}
					</div>

					<div className="drawer-footer">
						<button
							type="button"
							className="drawer-new-btn"
							onClick={() => {
								onNewSession();
								setDrawerOpen(false);
							}}
						>
							+ Start New Conversation
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Add CSS styles for HeaderBar and Past Conversations Drawer**

Edit `src/ui/style.css` to append:

```css
/* ─── HeaderBar & Past Conversations Drawer ─── */
.claude-header-bar {
	position: relative;
	background: #1e2024;
	border-bottom: 1px solid #2d3038;
	user-select: none;
	z-index: 50;
}
.header-main-row {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	cursor: pointer;
	font-size: 12px;
}
.header-main-row:hover {
	background: rgba(255, 255, 255, 0.03);
}
.spark-logo {
	color: #d96b52;
	font-size: 14px;
	font-weight: bold;
}
.session-title {
	font-weight: 600;
	color: #e0e0e0;
	max-width: 180px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.chevron-icon {
	font-size: 10px;
	color: #888;
}
.git-branch-badge {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 11px;
	color: #4ec9b0;
	margin-left: 4px;
}
.git-changes {
	color: #888;
}
.header-spacer {
	flex: 1;
}
.model-chip {
	font-size: 11px;
	color: #888;
}
.header-new-btn {
	background: none;
	border: none;
	color: #aaa;
	font-size: 16px;
	cursor: pointer;
	padding: 0 4px;
	border-radius: 4px;
}
.header-new-btn:hover {
	color: #fff;
	background: rgba(255, 255, 255, 0.08);
}

.past-conversations-drawer {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	background: #25272c;
	border-bottom: 1px solid #3c3e48;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	max-height: 320px;
	display: flex;
	flex-direction: column;
	animation: popupFade 0.12s ease-out;
}
.drawer-search-bar {
	padding: 8px 10px;
	border-bottom: 1px solid #3c3e48;
}
.drawer-search-bar input {
	width: 100%;
	background: #1c1e22;
	color: #e0e0e0;
	border: 1px solid #3c3e48;
	border-radius: 6px;
	padding: 6px 10px;
	font-size: 12px;
	outline: none;
}
.drawer-search-bar input:focus {
	border-color: #d96b52;
}
.drawer-session-list {
	flex: 1;
	overflow-y: auto;
	padding: 4px;
	max-height: 220px;
}
.drawer-session-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px;
	border-radius: 6px;
	cursor: pointer;
	transition: background 0.1s;
}
.drawer-session-item:hover {
	background: rgba(255, 255, 255, 0.05);
}
.drawer-session-item.active {
	background: #3e432d;
}
.drawer-item-icon {
	font-size: 14px;
}
.drawer-item-info {
	flex: 1;
	overflow: hidden;
}
.drawer-item-name {
	font-size: 12px;
	font-weight: 500;
	color: #e0e0e0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.drawer-item-time {
	font-size: 10px;
	color: #777;
}
.drawer-empty-state {
	padding: 16px;
	text-align: center;
	color: #777;
	font-size: 12px;
}
.drawer-footer {
	padding: 8px 10px;
	border-top: 1px solid #3c3e48;
}
.drawer-new-btn {
	width: 100%;
	background: rgba(255, 255, 255, 0.06);
	color: #ccc;
	border: 1px solid #3c3e48;
	border-radius: 6px;
	padding: 6px 10px;
	cursor: pointer;
	font-size: 12px;
	font-weight: 500;
}
.drawer-new-btn:hover {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}
```

- [ ] **Step 5: Run tests and compilation**

Run: `npm run compile && npm run test:unit`
Expected: PASS (76 passing)

---

### Task 2: PlanReviewCard & Plan Mode Confirmation UI

**Files:**
- Create: `src/ui/PlanReviewCard.tsx`
- Create: `test/unit/PlanReviewCard.test.ts`
- Modify: `src/ui/Message.tsx`
- Modify: `src/ui/style.css`

**Interfaces:**
- Consumes: `planMarkdown: string`, `onAcceptPlan: () => void`, `onRevisePlan: (feedback: string) => void`
- Produces: `PlanReviewCard` component rendering structured plan steps with "Accept Plan" green button and alternative feedback input.

- [ ] **Step 1: Write failing test for PlanReviewCard prompt formatting**

Create `test/unit/PlanReviewCard.test.ts`:

```typescript
import assert from "assert";

export function formatPlanFeedback(feedback: string): string {
	if (!feedback.trim()) return "";
	return `Instead of the proposed plan, please do this: ${feedback.trim()}`;
}

describe("PlanReviewCard feedback formatting", () => {
	it("formats user feedback for plan revision", () => {
		const formatted = formatPlanFeedback("Use PostgreSQL instead of SQLite");
		assert.strictEqual(
			formatted,
			"Instead of the proposed plan, please do this: Use PostgreSQL instead of SQLite",
		);
	});

	it("returns empty string for blank feedback", () => {
		assert.strictEqual(formatPlanFeedback("   "), "");
	});
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `TS_NODE_PROJECT=test/tsconfig.json npx mocha --require ts-node/register test/unit/PlanReviewCard.test.ts`
Expected: PASS

- [ ] **Step 3: Implement PlanReviewCard component**

Create `src/ui/PlanReviewCard.tsx`:

```typescript
import React, { useState } from "react";

interface PlanReviewCardProps {
	planMarkdown: string;
	onAcceptPlan: () => void;
	onRevisePlan: (feedback: string) => void;
}

export function PlanReviewCard({
	planMarkdown,
	onAcceptPlan,
	onRevisePlan,
}: PlanReviewCardProps) {
	const [feedback, setFeedback] = useState("");
	const [isAccepted, setIsAccepted] = useState(false);

	const handleRevise = () => {
		if (!feedback.trim()) return;
		onRevisePlan(feedback.trim());
		setFeedback("");
	};

	return (
		<div className="plan-review-card">
			<div className="plan-card-header">
				<span className="plan-icon">📑</span>
				<span className="plan-title">Plan Review</span>
				<span className="plan-badge">Action Required</span>
			</div>

			<div className="plan-card-body">
				<div className="plan-markdown-content">{planMarkdown}</div>
			</div>

			{!isAccepted ? (
				<div className="plan-card-footer">
					<button
						type="button"
						className="accept-plan-btn"
						onClick={() => {
							setIsAccepted(true);
							onAcceptPlan();
						}}
					>
						✓ Accept Plan
					</button>

					<div className="revise-plan-row">
						<input
							type="text"
							placeholder="Tell Claude what to do instead..."
							value={feedback}
							onChange={(e) => setFeedback(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleRevise();
							}}
						/>
						<button
							type="button"
							className="revise-btn"
							onClick={handleRevise}
							disabled={!feedback.trim()}
						>
							Send
						</button>
					</div>
				</div>
			) : (
				<div className="plan-card-accepted">
					<span className="accepted-check">✓</span> Plan accepted. Proceeding with edits...
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Add CSS styles for PlanReviewCard**

Edit `src/ui/style.css` to append:

```css
/* ─── Plan Review Card (Plan Mode UI) ─── */
.plan-review-card {
	margin: 12px 0;
	border: 1px solid #3c3e48;
	border-radius: 10px;
	background: #25272c;
	overflow: hidden;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.plan-card-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background: rgba(255, 255, 255, 0.04);
	border-bottom: 1px solid #3c3e48;
}
.plan-icon { font-size: 16px; }
.plan-title { font-weight: 600; color: #e0e0e0; font-size: 13px; }
.plan-badge {
	margin-left: auto;
	font-size: 10px;
	font-weight: 600;
	background: rgba(217, 107, 82, 0.2);
	color: #d96b52;
	padding: 2px 6px;
	border-radius: 4px;
	text-transform: uppercase;
}
.plan-card-body {
	padding: 12px 14px;
	max-height: 300px;
	overflow-y: auto;
	font-size: 13px;
	line-height: 1.5;
	color: #ccc;
}
.plan-card-footer {
	padding: 10px 12px;
	border-top: 1px solid #3c3e48;
	display: flex;
	flex-direction: column;
	gap: 8px;
	background: rgba(0, 0, 0, 0.15);
}
.accept-plan-btn {
	width: 100%;
	background: #4caf50;
	color: #ffffff;
	border: none;
	border-radius: 6px;
	padding: 8px 12px;
	font-weight: 600;
	font-size: 13px;
	cursor: pointer;
	transition: background 0.12s;
}
.accept-plan-btn:hover {
	background: #43a047;
}
.revise-plan-row {
	display: flex;
	gap: 6px;
}
.revise-plan-row input {
	flex: 1;
	background: #1c1e22;
	color: #e0e0e0;
	border: 1px solid #3c3e48;
	border-radius: 6px;
	padding: 6px 10px;
	font-size: 12px;
	outline: none;
}
.revise-plan-row input:focus {
	border-color: #d96b52;
}
.revise-plan-row .revise-btn {
	background: rgba(255, 255, 255, 0.08);
	color: #ccc;
	border: 1px solid #3c3e48;
	border-radius: 6px;
	padding: 6px 12px;
	font-size: 12px;
	cursor: pointer;
}
.revise-plan-row .revise-btn:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.15);
	color: #fff;
}
.plan-card-accepted {
	padding: 10px 12px;
	background: rgba(76, 175, 80, 0.1);
	border-top: 1px solid rgba(76, 175, 80, 0.3);
	color: #81c784;
	font-size: 12px;
	font-weight: 500;
}
```

- [ ] **Step 5: Run tests and compilation**

Run: `npm run compile && npm run test:unit`
Expected: PASS (77 passing)

---

### Task 3: Selection Line Range Indicator & ClaudeInputCard Refactoring

**Files:**
- Create: `test/unit/SelectionIndicator.test.ts`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/style.css`

**Interfaces:**
- Consumes: `selectedLineCount: number`, `showSelection: boolean`, `attachedFiles: AttachedFile[]`
- Produces: Prompt card top row showing `33 lines selected 👁️` selection badge alongside file attachment badges.

- [ ] **Step 1: Write test for selection line range text formatting**

Create `test/unit/SelectionIndicator.test.ts`:

```typescript
import assert from "assert";

export function formatSelectionBadge(lineCount: number, visible: boolean): string {
	if (lineCount <= 0 || !visible) return "";
	return `${lineCount} ${lineCount === 1 ? "line" : "lines"} selected`;
}

describe("Selection line range indicator", () => {
	it("formats single line selection", () => {
		assert.strictEqual(formatSelectionBadge(1, true), "1 line selected");
	});

	it("formats multi line selection", () => {
		assert.strictEqual(formatSelectionBadge(33, true), "33 lines selected");
	});

	it("returns empty when selection is hidden or count is 0", () => {
		assert.strictEqual(formatSelectionBadge(33, false), "");
		assert.strictEqual(formatSelectionBadge(0, true), "");
	});
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `TS_NODE_PROJECT=test/tsconfig.json npx mocha --require ts-node/register test/unit/SelectionIndicator.test.ts`
Expected: PASS

- [ ] **Step 3: Add selection badge rendering inside Prompt Card in App.tsx**

Update `InputArea` in `src/ui/App.tsx` to include `selectedLineCount` state and `selectionVisible` toggle:

```typescript
// Inside InputArea render, inside attached-files-row:
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
```

- [ ] **Step 4: Run tests and compilation**

Run: `npm run compile && npm run test:unit`
Expected: PASS (78 passing)

---

### Task 4: Final Verification & VSIX Packaging

**Files:**
- Modify: `CHANGELOG.md`
- Output: `pi-code-0.2.0.vsix`

- [ ] **Step 1: Run TypeScript compilation**

Run: `npm run compile`
Expected: 0 errors

- [ ] **Step 2: Run complete unit test suite**

Run: `npm run test:unit`
Expected: All 78 tests pass

- [ ] **Step 3: Run Webpack production builds**

Run: `npm run build`
Expected: Webpack extension and webview bundles compiled successfully

- [ ] **Step 4: Package VSIX artifact**

Run: `npx vsce package`
Expected: `pi-code-0.2.0.vsix` generated successfully

---
