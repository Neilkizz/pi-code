# Claude Code UI/UX 1:1 Replica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Pi Code VS Code extension webview into a 100% 1:1 visual and interactive replica of Anthropic's official Claude Code VS Code Extension.

**Architecture:** React 18 webview UI, modular CSS-in-VSCode-theme (variables), RPC protocol layer.

**Tech Stack:** TypeScript, React, Webpack, Mocha (tests).

## Global Constraints

- No external CSS frameworks — use pure VS Code theme variables (`var(--vscode-...)`).
- TypeScript strict mode must be preserved.
- All new UI components must be modular and testable.
- VSIX must package successfully without errors.

---

### Task 1: HeaderBar & Past Conversations HistoryDrawer

**Files:**
- Create: `src/ui/HeaderBar.tsx`, `test/unit/HeaderBar.test.ts`
- Modify: `src/ui/App.tsx`, `src/ui/style.css`

**Interfaces:**
- Consumes: `sessions: SessionItem[]`, `activeSessionId: string`
- Produces: `HeaderBar` with session title dropdown, git branch info, and a drawer for history.

- [ ] **Step 1: Write the failing test for HeaderBar session filtering**

```typescript
import assert from "assert";
import { filterSessions, type SessionItem } from "../src/ui/HeaderBar";

describe("HeaderBar filterSessions", () => {
	it("returns all sessions when search query is empty", () => {
		const sessions: SessionItem[] = [
			{ id: "1", name: "Fix auth bug", timestamp: 1000 },
			{ id: "2", name: "Refactor db", timestamp: 2000 },
		];
		assert.strictEqual(filterSessions(sessions, "").length, 2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TS_NODE_PROJECT=test/tsconfig.json npx mocha --require ts-node/register test/unit/HeaderBar.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement HeaderBar and HistoryDrawer**

- Create `src/ui/HeaderBar.tsx`
- Implement Drawer logic with `useState` and `useEffect` for clicking outside.

- [ ] **Step 4: Update style.css**

- Add CSS for `.claude-header-bar`, `.past-conversations-drawer`.

- [ ] **Step 5: Integrate into App.tsx**

- Import `HeaderBar`, mount at top of `chat-container`.

- [ ] **Step 6: Run tests and compilation**

Run: `npm run compile && npm run test:unit`
Expected: PASS

---

### Task 2: ClaudeInputCard & Modes/Actions Menu

**Files:**
- Create: `src/ui/ModesMenu.tsx`, `src/ui/ActionsMenu.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/style.css`

**Interfaces:**
- Consumes: `mode: PermissionMode`, `effort: EffortLevel`
- Produces: Floating popups for Mode selection (⚡, ✋) and Actions (Context/Model).

- [ ] **Step 1: Implement ModesMenu component**
- [ ] **Step 2: Implement ActionsMenu component**
- [ ] **Step 3: Refactor InputArea in App.tsx to Prompt Card structure**
- [ ] **Step 4: Update style.css for terracotta styles**

---

### Task 3: PlanReviewCard & Message Formatting

**Files:**
- Create: `src/ui/PlanReviewCard.tsx`, `test/unit/PlanReviewCard.test.ts`
- Modify: `src/ui/Message.tsx`, `src/ui/style.css`

**Interfaces:**
- Consumes: `planMarkdown: string`
- Produces: `PlanReviewCard` for plan approval.

- [ ] **Step 1: Write test for PlanReviewCard**
- [ ] **Step 2: Implement PlanReviewCard**
- [ ] **Step 3: Update MessageItem rendering in Message.tsx**

---

### Task 4: Final Verification & VSIX Packaging

- [ ] **Step 1: Run full test suite (Compile + Mocha)**
- [ ] **Step 2: Webpack production build**
- [ ] **Step 3: VSIX packaging**
