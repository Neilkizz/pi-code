# Claude Code VS Code Extension 1:1 UI/UX Replica Design Spec

**Date:** 2026-07-28  
**Status:** Approved  
**Scope:** Complete 1:1 visual and interactive replication of Anthropic's official Claude Code VS Code Extension.

---

## 1. Overview & Objectives

The goal is to align the UI/UX of the `pi-code` extension 100% with the official Claude Code VS Code extension across all visual components, popups, prompt box card, context badges, and plan confirmation flows.

---

## 2. Architecture & Components Breakdown

### 2.1 Header & History Drawer (`HeaderBar.tsx` & `HistoryDrawer.tsx`)
- **Header Bar**: Minimalist header showing active session name, branch context, and an expand icon.
- **Past Conversations Drawer**: Dropdown menu triggered by clicking the session title.
  - Lists historical conversations with timestamp, message count, and preview title.
  - Action items: "New conversation", "Clear all history", "Search past chats".
  - Quick session switching.

### 2.2 Claude Prompt Card (`ClaudeInputCard.tsx`)
- **Outer Box**: 12px border-radius, terracotta orange border (`#d96b52` / `#e27d60`) on focus, dark background (`#25272c`).
- **Context Badges Row**:
  - Image / File attachment pills with dimensions (`📷 image.png 872×1512 ×`).
  - Selection Line Range indicator: `33 lines selected` with toggleable eye icon `👁️`.
  - Line range mentions (`@file.ts#L10-L25`).
- **Control Bar**:
  - Left buttons: `+` (Actions Menu trigger), `[/]` (Slash / Mention trigger).
  - Mode Pill Button: `⚡ Auto` (triggers `ModesMenu` on click or `Shift+Tab`).
  - Terracotta Square Submit Button: `↑` (up arrow) when idle, `■` (red stop square) when streaming.

### 2.3 Popups (`ModesMenu.tsx` & `ActionsMenu.tsx`)
- **`ModesMenu`**:
  - Header with `[ ⇧ + tab  to switch ]` shortcut badge.
  - Modes: `✋ Manual`, `</> Edit automatically`, `📑 Plan`, `⚡ Auto`, `⇄ Bypass permissions`.
  - Selected item highlighted with olive green tint (`#3e432d`) and green checkmark (`✓`).
  - 5-dot Effort slider (`Off`, `Low`, `Med`, `High`, `Max`), where `Max` has a purple dot (`#ba68c8`).
- **`ActionsMenu`**:
  - Header search: `Filter actions...`.
  - Group `Context`: `Attach file...`, `Mention file from this project...`, `Clear conversation`, `Rewind`.
  - Group `Model`: `Switch model...`, `Effort (Max)` slider, `Thinking` toggle switch, `Switch models when a message is flagged` toggle switch, `Account & usage...`.

### 2.4 Plan virtual document & CodeLens (`PlanContentProvider`)
- **`pi-plan` Scheme**: Register a TextDocumentContentProvider to serve the plan Markdown at `pi-plan://plan/session-id.md` in the editor tab.
- **CodeLens Integration**:
  - Displays `Accept Plan` (one-click run for command `pi.acceptPlan` to start edits).
  - Displays `Revise Plan` (one-click run for command `pi.revisePlan` to ask user for comments and send as feedback).

### 2.5 Formatting & Tool Execution Blocks (`Message.tsx`)
- Bullet dot indicators: `● Thinking` (gray), `● ToolName` (green for done, blue for running, red for error).
- Structured `IN` / `OUT` code blocks for bash and edit tool details.
- Clean typography and Markdown syntax highlighting.

---

## 3. Data Flow & State Management

- `App.tsx` acts as the central state hub.
- Props passed down to `ClaudeInputCard`, `HeaderBar`, `ModesMenu`, `ActionsMenu`, and `PlanReviewCard`.
- `WebviewMessenger` relays state snapshot, history, file suggestions, diagnostics, and git status between Extension Host and Webview.

---

## 4. Verification Plan

1. **Build & Type Check**: Run `npm run compile` and `npm run build` to verify zero TypeScript errors and successful Webpack bundles.
2. **Unit Tests**: Run `npm run test:unit` to ensure all 75 unit tests pass.
3. **VSIX Packaging**: Run `npx vsce package` to generate updated `pi-code-0.2.0.vsix`.
