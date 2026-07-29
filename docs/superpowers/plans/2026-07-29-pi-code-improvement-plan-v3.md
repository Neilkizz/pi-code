# Pi Code Improvement Plan — v3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Systematically improve Pi Code VS Code extension from v0.2.0 to production-ready, addressing test gaps, code quality, missing delivery features, architectural debt, and ALL known critique findings.

**Architecture:** Five-layer decoupled extension (Extension Host → Session Manager → PiRpcClient → pi CLI subprocess) with React webview UI.

**Tech Stack:** TypeScript 5, React 18, VS Code API ^1.85.0, Webpack 5, Mocha 10, Node >=18

---

## Round 2 Critique Response

| # | Finding | Severity | Verdict | Rationale |
|---|---------|----------|---------|-----------|
| F2.1 | Permission mode migration silently downgrades `"off"` → `"auto"` | CRITICAL | **ACCEPT** | Added migration handler in Phase 3 Task 3.1 mapping `"off"` → `"readonly"` with one-time notification. package.json schema updated atomically. |
| F2.2 | Audit log is in-memory, spec requires persistence (F-513) | HIGH | **ACCEPT** | Added JSONL file persistence in `globalStoragePath` as primary store, with in-memory buffer for quick access. F-513 scope note added. |
| F2.3 | Phase 4 measurement step is un-executable by agent | HIGH | **ACCEPT** | Replaced `console.time` measurement with static code-path analysis of `findFiles` call frequency per file-open event. |
| F2.4 | No error-path tests for ChatProvider dispatch | HIGH | **ACCEPT** | Added 3 error-path test scenarios to Task 2.2: `s.prompt()` rejects, `diff.acceptCurrent()` throws, `autosaveFiles` save fails. |
| F2.5 | No integration test for out-of-order event delivery | HIGH | **ACCEPT** | Added test case to Task 1.3 where `tool_execution_end` arrives before `tool_execution_start` (silent drop → stuck indicator). |
| F2.6 | Config sanitization too shallow (only log output) | MEDIUM | **ACCEPT** | Added `sanitizeLogMessage` call inside each Configuration getter at data-entry point, not just at log output. pi CLI session file scope noted. |
| F2.7 | No backward compatibility for permission mode | MEDIUM | **ACCEPT** | Added migration table mapping old→new values. package.json `contributes.configuration` enum updated in same commit. |
| F2.8 | KI-001 (@-mention sanitization) and KI-006 (terminal shell) not addressed | MEDIUM | **ACCEPT** | Added KI-001 task to Phase 3 (sanitize @-mention display text). KI-006 explicitly deferred with justification in known-issues.md update. |
| F2.9 | Phase 0 Task 0.1 produces no artifact | LOW | **ACCEPT** | Updated Task 0.1 to write blocked/feasible labels directly into `docs/delivery-checklist.md` before committing. |
| F2.10 | 6 of 19 PRD user stories permanently blocked | LOW | **ACCEPT** | Added "PRD Deliverability" section in preamble listing deliverable vs. blocked user stories. |
| F2.11 | TECH_DESIGN.md not updated for architecture changes | LOW | **ACCEPT** | Added explicit Task 5.3 to update TECH_DESIGN.md with useReducer architecture, new modules (ContextBuilder, GitStatusReader, ChangeTracker), command classifier, audit log. |
| F2.12 | No timeline or effort estimate | LOW | **ACCEPT** | Added person-day estimates per task in a summary table. Total ~52 person-days. |
| F2.13 | No risk register | LOW | **ACCEPT** | Added "Risks and Mitigations" section with top 3 risks and mitigations. |
| F2.14 | Command classification not documented as UX guardrail | LOW | **ACCEPT** | Added explicit note in Phase 3 Task 3.1: "This is a best-effort UX guardrail, not a security boundary." |

---

## Effort Estimates

| Task | Description | Person-Days | Parallelizable |
|------|-------------|-------------|----------------|
| 0.1 | RPC gap audit + delivery-checklist update | 1 | Yes |
| 0.2 | Test inventory + coverage baseline | 1 | Yes |
| 0.3 | Formatting + linting foundation | 1 | Yes |
| 1.1 | App.tsx useReducer refactoring | 4 | No |
| 1.2 | ChatProvider decomposition | 3 | No |
| 1.3 | Extend integration tests | 3 | No |
| 1.4 | Fix imports + extracted module tests | 2 | No |
| 2.1 | SessionManager + DiffController etc. unit tests | 4 | No |
| 2.2 | ChatProvider dispatch tests (incl. error paths) | 3 | No |
| 3.1 | Command classifier + permission mode migration | 4 | Yes (with 3.2) |
| 3.2 | Command preview + audit log with persistence | 5 | Yes (with 3.1) |
| 3.3 | Config sanitization at entry point + @-mention sanitization | 3 | Yes (with 3.1) |
| 3.4 | Environment inheritance (F-511) | 2 | Yes |
| 3.5 | Multi-position display (F-004) — stretch | 5 | Yes |
| 4.1 | FileSystemWatcher for file suggestions | 3 | No |
| 4.2 | Virtual scrolling investigation | 1 | Yes |
| 5.1 | Pre-commit hook + CI integration | 1 | Yes |
| 5.2 | Delivery-checklist + known-issues final update | 1 | No |
| 5.3 | TECH_DESIGN.md architecture update | 1 | No |
| **Total** | | **~48** (+5 stretch) | |

---

## PRD Deliverability

Of the 19 PRD user stories (US-01 through US-19), the following are deliverable at the extension layer vs. permanently blocked:

| ID | User Story | Deliverable? | Phase/Task |
|----|-----------|-------------|------------|
| US-01 | Chat with AI Agent in VS Code | ✅ Already delivered | — |
| US-02 | Read current file / selection | ✅ Already delivered | — |
| US-03 | Search entire codebase | ⚠️ Delegated to pi CLI | — |
| US-04 | Plan mode: generate and approve plans | ❌ **BLOCKED** (needs pi CLI plan RPC) | — |
| US-05 | Review code modifications (accept/reject) | ✅ Already delivered | — |
| US-06 | Run terminal commands with live output | ✅ Already delivered | — |
| US-07 | Parallel independent sessions | ✅ Already delivered | — |
| US-08 | Switch between LLM providers/models | ✅ Already delivered | — |
| US-09 | Control agent reasoning depth | ✅ Already delivered | — |
| US-10 | Interrupt running tasks | ✅ Already delivered | — |
| US-11 | Rollback code changes | ❌ **BLOCKED** (needs pi CLI checkpoint/rollback RPC) | — |
| US-12 | Recover sessions after restart | ✅ Already delivered | — |
| **US-13** | Configure permission modes (readonly/plan/manual/auto) | ✅ In this plan | Phase 3 Task 3.1 |
| US-14 | Create custom skills | ❌ **BLOCKED** (needs pi CLI skills RPC) | — |
| US-15 | Git workflow (branch/commit/PR) | ⚠️ Status display ✅; write ops blocked on pi CLI | — |
| **US-16** | @-mention file/symbol references | ✅ Already delivered (sanitization in Phase 3 Task 3.3) | Phase 3 Task 3.3 |
| US-17 | Slash commands | ✅ Already delivered | — |
| US-18 | Fork sessions | ✅ Already delivered | — |
| US-19 | MCP crash isolation | ❌ **BLOCKED** (needs pi CLI MCP management RPC) | — |

**Summary:** 12 of 19 user stories are already delivered or deliverable in this plan. 4 are permanently blocked on pi CLI RPC protocol (US-04, US-11, US-14, US-19). 2 are partially delivered (US-03, US-15). 1 is fully delivered in this plan (US-13).

---

## Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **ChatProvider decomposition breaks session subscription:** Splitting a 419-line monolith into 3-4 modules may introduce timing bugs in `syncSubscriptions` or event forwarding. | Medium | High — session event loss would break the entire chat UX | Stepwise extraction with tests after each extraction. Keep `syncSubscriptions` and `dispatch` in ChatProvider as coordination glue. No structural change to event flow. |
| R2 | **useReducer introduces subtle state bugs:** The 13 `useState` calls in App.tsx have implicit invariants (e.g., `activeSessionId` ref mirrors state). A single reducer may flatten these in unexpected ways. | Medium | High — incorrect message rendering, session confusion | Write `appReducer` as a pure function with 10+ unit tests before touching App.tsx. Test all action types combinatorially. The old `reduceMessages` remains as a fallback reference. |
| R3 | **Mock integration tests don't match real pi CLI behavior:** RPC integration tests use a mock server that may not faithfully reproduce pi CLI edge cases (partial JSON, banner lines, crash recovery). | Medium | High — tests pass but extension breaks against real pi CLI | Add one `npm run smoke:rpc` step using real pi CLI (skipped in CI but run manually before release). Document divergence points between mock and real server. |

---

## Dependency Graph

```
Phase 0: Context Assessment (parallel, no deps)
  0.1 ── RPC gap + delivery-checklist update (writes to docs/, not just commit)
  0.2 ── Test inventory + coverage baseline
  0.3 ── Formatting + linting setup

Phase 1: Architecture + Testing (depends on Phase 0)
  ┌─ 1.1 ── App.tsx useReducer refactoring (no deps on other Phase 1)
  │         BREAKS: test/unit/reduceMessages.test.ts imports — fix in step 1.4
  ├─ 1.2 ── ChatProvider decomposition (no deps on 1.1 — different process domain)
  ├─ 1.3 ── Extend integration tests (partial JSON, U+2028, dual tool, concurrent sessions,
  │         out-of-order events)
  └─ 1.4 ── Fix broken imports from 1.1 + add unit tests for extracted modules

Phase 2: Fill Untested Modules (depends on 1.2 — ChatProvider must be decomposed first)
  2.1 ── SessionManager + DiffController + Configuration + PiSession unit tests
  2.2 ── ChatProvider dispatch tests (14 success + 3 error-path scenarios)

Phase 3: Missing Delivery Features (can start parallel with Phase 1 after 0.1)
  3.1 ── Command classifier (F-512) + permission mode migration (F2.1 fix) — reuse validation.ts
  3.2 ── Command preview (F-502) + audit log with JSONL persistence (F-513)
  3.3 ── Config sanitization (S-002, F2.6 fix) + @-mention sanitization (KI-001)
  3.4 ── Environment inheritance (F-511)
  3.5 ── Multi-position display (F-004) — stretch

Phase 4: Performance (depends on Phase 1.3 — integration test harness)
  4.1 ── FileSystemWatcher for file suggestions (code-path analysis, not measurement)
  4.2 ── Virtual scrolling + KI-006 deferral note (investigation)

Phase 5: Engineering Excellence (depends on Phase 0.3 + Phase 2)
  5.1 ── Pre-commit hook + CI integration
  5.2 ── Update delivery-checklist.md + known-issues.md
  5.3 ── Update TECH_DESIGN.md for all architecture changes
```

---

## Phase 0: Context Assessment

### Task 0.1: RPC Gap Inventory & Delivery-Checklist Update

**Files:** Read-only audit + modify `docs/delivery-checklist.md`
- Read: `docs/delivery-checklist.md`, `ROADMAP.md`, `交付标准.md`

**Goal:** Catalog which delivery items are blocked on pi CLI RPC vs. feasible in extension layer, so the remaining plan works on what it can actually deliver. **Produce a tracked artifact in delivery-checklist.md, not just a commit message.**

- [ ] **Step 1: Read delivery-checklist.md and ROADMAP.md**

```bash
cat docs/delivery-checklist.md
cat ROADMAP.md
```

- [ ] **Step 2: Classify every ❌ delivery item**

Label each as:
- **Blocked (pi CLI RPC):** Needs new pi CLI command or event — extension cannot unilaterally deliver
- **Extension-feasible:** Can be implemented in the extension with no pi CLI protocol change
- **Stretch:** Possible but requires significant new code or cross-cutting change

**Blocked (pi CLI RPC)** — do not attempt:
- F-301~F-307 (plan mode RPC commands)
- F-405 (user secondary edit — needs pi CLI to expose pre-write candidate)
- F-705~F-711 (checkpoints/rollback RPC)
- Provider adapter section 4 (pi CLI protocol)
- MCP management section 5.1 (pi CLI protocol)
- Sub-agent section 5.4 (pi CLI protocol)
- Git write operations section 3.10 (pi CLI protocol)
- Streaming state machine T-001~T-012 (pi CLI protocol)
- Stream failover section 4.4 (pi CLI protocol)
- E2E scenarios that need pi CLI protocol changes (#8/9/10/18/19)
- S-009 (network whitelist — pi CLI manages network access)

**Extension-feasible** — included in this plan:
- F-502 (command preview — Phase 3, Task 3.2)
- F-511 (env inheritance — Phase 3, Task 3.4)
- F-512 (sensitive command — Phase 3, Task 3.1)
- F-513 (audit log — Phase 3, Task 3.2)
- F-004 (multi-position display — Phase 3, Task 3.5 stretch)
- S-002 (config sanitization — Phase 3, Task 3.3)

- [ ] **Step 3: Write labels into delivery-checklist.md**

Update each ❌ row in `docs/delivery-checklist.md` with a `[Blocked: pi CLI RPC]` or `[Planned: Phase 3.X]` label so the classification is version-controlled and readable by anyone opening the file.

Specifically update:
- F-301~F-307 rows: change status to `❌ [Blocked: pi CLI RPC]`
- F-405 row: change status to `❌ [Blocked: pi CLI RPC]`
- F-502 row: change status to `❌ → ⚡[Planned: Phase 3.2]`
- F-511 row: change status to `❌ → ⚡[Planned: Phase 3.4]`
- F-512 row: change status to `❌ → ⚡[Planned: Phase 3.1]`
- F-513 row: change status to `❌ → ⚡[Planned: Phase 3.2]`
- F-705~F-711 rows: change status to `❌ [Blocked: pi CLI RPC]`
- S-002 row: change status to `❌ → ⚡[Planned: Phase 3.3]`
- S-009 row: change status to `❌ [Blocked: pi CLI RPC]`
- S-015 row: change status to `❌ → ⚡[Planned: Phase 3.2]`

- [ ] **Step 4: Commit the artifact**

```bash
git add docs/delivery-checklist.md && git commit -m "docs: RPC gap inventory with blocked/feasible labels in delivery-checklist.md"
```

---

### Task 0.2: Test Inventory & Coverage Baseline

**Files:** Read-only audit
- Read: `test/integration/` (5 files, 634 lines, 29 test cases)
- Read: `test/unit/` (10 files, 1396 lines, 75 test cases)

**Goal:** Know what exists before duplicating. Establish a real coverage baseline.

- [ ] **Step 1: Read all existing integration tests**

```bash
wc -l test/integration/mockRpcServer.ts test/integration/rpc-*.test.ts
```

Existing integration tests already cover:
- Lifecycle (start/dispose/start-idempotent/crash-restart): 8 tests
- All 12 RPC command types round-trip: 13 tests
- Protocol edge cases (garbage lines, sequential commands, concurrent FIFO): 5 tests
- Timeout handling (slow/hang/crash+queue): 3 tests
- Event stream (events scenario): part of rpc-commands.test.ts

- [ ] **Step 2: Inventory existing unit test coverage**

```bash
# Count tests per module
grep -c "describe\|it(" test/unit/*.test.ts
```

Existing unit tests:
- `reduceMessages.test.ts`: 546 lines, 19 tests — covers message state machine
- `PiRpcClient.test.ts`: 213 lines, 16 tests — covers PiEventBus and client construction
- `lineReader.test.ts`: 129 lines, 12 tests — covers JSONL parsing, U+2028/2029, flush
- `requestQueue.test.ts`: 92 lines, 6 tests — covers enqueue/dequeue/clear
- `security.test.ts`: 86 lines, 13 tests — covers path safety, sensitive files, log sanitization
- `decodeFromWebview.test.ts`: 66 lines — covers message type whitelist
- `parseUnifiedDiff.test.ts`: 69 lines — covers diff hunk parsing
- `HeaderBar.test.ts`: 16 lines
- `PlanReviewCard.test.ts`: 16 lines
- `SelectionIndicator.test.ts`: 17 lines

**Untested modules (1717 LOC with zero tests):**
- `src/view/ChatProvider.ts` (419 lines)
- `src/session/SessionManager.ts` (163 lines)
- `src/session/PiSession.ts` (134 lines)
- `src/diff/DiffController.ts` (334 lines)
- `src/settings/Configuration.ts` (127 lines + THINKING_LEVELS)
- `src/auth/AuthService.ts`
- `src/terminal/PiTerminal.ts`
- `src/view/SessionTreeProvider.ts`
- `src/view/WebviewMessenger.ts`

- [ ] **Step 3: Commit baseline**

```bash
git add test/ && git commit -m "audit: test inventory and coverage baseline"
```

---

### Task 0.3: Formatting + Linting Foundation

**Files:**
- Create: `.prettierrc`
- Modify: `package.json` — add format, lint:fix scripts

- [ ] **Step 1: Create .prettierrc**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 2: Add format scripts to package.json**

```bash
# In scripts section add:
# "format": "prettier --write \"src/**/*.{ts,tsx}\" \"test/**/*.ts\""
# "format:check": "prettier --check \"src/**/*.{ts,tsx}\" \"test/**/*.ts\""
```

- [ ] **Step 3: Format entire codebase once**

```bash
npm run format
```

- [ ] **Step 4: Run tests (formatting must not break anything)**

```bash
npm run test:unit && npm run test:integration
```

- [ ] **Step 5: Commit**

```bash
git add .prettierrc package.json && git commit -m "chore: add Prettier config and format codebase"
```

---

## Phase 1: Architecture + Testing

### Task 1.1: App.tsx useReducer Refactoring

**Files:**
- Create: `src/ui/AppState.ts` — AppState interface, AppAction union, appReducer
- Create: `src/ui/WelcomeScreen.tsx` — extract inline component
- Create: `src/ui/InputArea.tsx` — extract inline component
- Modify: `src/ui/App.tsx` — strip to layout + dispatch
- Modify: `test/unit/reduceMessages.test.ts` — fix imports to `AppState`

**CRITICAL:** This refactoring changes the import path for `reduceMessages`, `convertAgentMessages`, `textFromMsg`, `textFromResult`, `DisplayMessage` from `App` to `AppState`. The existing 19 tests in reduceMessages.test.ts will break. Fix them in step 1.4, not later.

**What this task actually fixes:**
- God switch statement with 13 `useState` calls → single `useReducer` with typed actions
- Implicit state coupling between messages, sessionId, streaming flag, model, thinking, suggestions, contextItems, gitBranch, gitChanges, changeSummary, sessionName, sessions
- `activeSessionIdRef` as mutable ref + `setActiveSessionId` as state — double-booked session tracking
- `onHostMessage` callback growing unbounded: each new message kind adds a new `set*` call

- [ ] **Step 1: Create `src/ui/AppState.ts`**

Extract from `App.tsx`:
- `DisplayMessage` interface
- `reduceMessages()` — the event → state reducer
- `convertAgentMessages()` — history message converter
- `textFromMsg()` / `textFromResult()` helpers
- `formatSelectionBadge()` helper

Add new typed action system:

```typescript
type AppAction =
  | { kind: "piEvent"; sessionId: string; event: PiEvent }
  | { kind: "stateSnapshot"; sessionId: string; model: string; thinkingLevel: string; isStreaming: boolean; sessionName: string; messageCount: number }
  | { kind: "history"; sessionId: string; messages: AgentMessage[] }
  | { kind: "fileSuggestions"; files: string[] }
  | { kind: "modelList"; models: { provider: string; id: string }[] }
  | { kind: "contextUpdate"; items: { label: string }[] }
  | { kind: "gitStatus"; branch: string; added: number; deleted: number; modified: number }
  | { kind: "changeSummary"; summary: string }
  | { kind: "selectSession"; sessionId: string };

interface AppState {
  activeSessionId: string | null;
  messages: DisplayMessage[];
  isStreaming: boolean;
  model: string;
  thinking: string;
  suggestions: string[];
  contextItems: string[];
  gitBranch: string;
  gitChanges: string;
  changeSummary: string;
  sessionName: string;
  sessions: SessionItem[];
}
```

Write `appReducer(state: AppState, action: AppAction): AppState` — a single pure function with no React dependencies. This makes the entire state logic testable without mounting React.

- [ ] **Step 2: Extract `WelcomeScreen.tsx`**

Already a separate `function WelcomeScreen` in App.tsx (~50 lines). Move to its own file with the `WelcomeScreenProps` type. Minimal change, purely mechanical.

- [ ] **Step 3: Extract `InputArea.tsx`**

The inline `InputArea` component (~200 lines) contains: text input, @-mention trigger, slash command trigger, drag-drop, attached files badges, mode pills, submit button. Extract to its own file with typed props.

- [ ] **Step 4: Rewrite `App.tsx`**

Replace the 13 `useState` calls with:

```typescript
const [state, dispatch] = useReducer(appReducer, initialState);
```

The `onHostMessage` callback becomes a single `dispatch(action)` call matching the kind to the action type. No more unbounded `set*` chain.

Target: ~120 lines of layout composition and dispatch wiring only.

- [ ] **Step 5: Fix `test/unit/reduceMessages.test.ts` imports**

Change:
```typescript
import { reduceMessages, convertAgentMessages, textFromMsg, textFromResult, type DisplayMessage } from "../../src/ui/App";
```
To:
```typescript
import { reduceMessages, convertAgentMessages, textFromMsg, textFromResult, type DisplayMessage } from "../../src/ui/AppState";
```

- [ ] **Step 6: Add appReducer unit tests**

Add `test/unit/appReducer.test.ts` covering:
1. Initial state is correct
2. `piEvent` action delegates to reduceMessages
3. `stateSnapshot` updates model, thinking, isStreaming
4. `stateSnapshot` with new sessionId resets messages
5. `history` action sets messages via convertAgentMessages
6. `selectSession` changes sessionId and clears messages
7. `fileSuggestions` updates suggestions array
8. `gitStatus` updates branch and changes string
9. Unknown action returns state unchanged (defensive)
10. Multiple actions compose correctly

- [ ] **Step 7: Run all tests and build**

```bash
npm run compile && npm run test:unit && npm run build
```

All 75 existing tests must still pass (19 reduceMessages tests with updated imports, others unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/ui/ test/unit/ && git commit -m "refactor: App.tsx useReducer, extract AppState/WelcomeScreen/InputArea"
```

---

### Task 1.2: ChatProvider Decomposition

**Files:**
- Create: `src/view/ContextBuilder.ts` — file/selection/diagnostic context assembly
- Create: `src/view/GitStatusReader.ts` — VS Code git extension reader
- Create: `src/view/ChangeTracker.ts` — tool_execution_end tracking for F-414
- Modify: `src/view/ChatProvider.ts` — slim to ~200 lines

**Problem:** ChatProvider (419 lines) manages 5-6 responsibilities mixed in one class:
1. WebviewView lifecycle (resolveWebviewView, buildHtml, reveal)
2. Session subscription management (syncSubscriptions, forward)
3. State pushing (pushState, pushFileSuggestions, pushContext, pushGitStatus, pushChangeSummary)
4. Event forwarding and tool tracking (forward → trackChange)
5. Webview message dispatching (dispatch — 13-kind switch)
6. Auto-session creation with error handling

**Solution:** Extract three focused modules that ChatProvider composes.

- [ ] **Step 1: Create `src/view/ContextBuilder.ts`**

Move from ChatProvider:
- `pushContext()` logic → `buildContextItems(): Promise<ContextItem[]>`
- `pushFileSuggestions()` logic → `getFileSuggestions(): Promise<FileSuggestion[]>`

Pure data assembly functions, no webview dependency. Returns data; caller decides how to push.

```typescript
export interface ContextItem { type: "file" | "selection" | "diagnostic"; label: string; detail?: string; removable: boolean; id: string; }
export async function buildContextItems(): Promise<ContextItem[]> { /* ... */ }
export interface FileSuggestion { path: string; isFile: boolean; }
export async function getFileSuggestions(config: { respectGitIgnore: boolean }): Promise<FileSuggestion[]> { /* ... */ }
```

- [ ] **Step 2: Create `src/view/GitStatusReader.ts`**

Move:
- `pushGitStatus()` logic → `readGitStatus(): Promise<GitStatus | null>`

```typescript
export interface GitStatus { branch: string; added: number; deleted: number; modified: number; ahead: number; behind: number; }
export async function readGitStatus(): Promise<GitStatus | null> { /* ... */ }
```

- [ ] **Step 3: Create `src/view/ChangeTracker.ts`**

Move:
- `pendingChanges` field + `trackChange()` + `pushChangeSummary()` logic

```typescript
export interface FileChange { file: string; action: "create" | "modify"; added: number; removed: number; }
export class ChangeTracker {
  private changes: FileChange[] = [];
  recordEvent(e: T.ToolExecutionEndEvent): void { /* ... */ }
  summarize(): string { /* ... */ }
}
```

- [ ] **Step 4: Slim ChatProvider.ts to ~200 lines**

After extraction, ChatProvider retains only:
- Constructor (inject SessionManager, DiffController, compose extracted modules)
- `resolveWebviewView()` — WebviewView lifecycle
- `reveal()` — show command
- `dispatch()` — message routing (keep, it's the coordination glue)
- `pushState()` — orchestrates ContextBuilder + GitStatusReader + ChangeTracker calls
- `forward()` — event → webview + ChangeTracker hook
- `syncSubscriptions()` — session event subscription management
- `buildHtml()` — HTML template
- `dispose()` — cleanup

Each extracted file has a single, testable responsibility.

- [ ] **Step 5: Run tests and build**

```bash
npm run compile && npm run test:unit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/view/ && git commit -m "refactor: decompose ChatProvider into ContextBuilder, GitStatusReader, ChangeTracker"
```

---

### Task 1.3: Extend Integration Tests

**Files:**
- Modify: `test/integration/mockRpcServer.ts` — add dual-tool event sequences, partial JSON chunking, out-of-order events
- Create: `test/integration/rpc-event-stream.test.ts`
- Modify: `test/integration/rpc-protocol.test.ts` — add U+2028, partial chunk tests

**Rationale:** The existing 29 integration tests cover lifecycle, commands, protocol garbage, and timeout. Missing:
1. Dual concurrent tool execution events (tool1_start → tool2_start → tool1_end → tool2_end)
2. Partial JSON chunk reassembly across multiple `data` events
3. U+2028/U+2029 inside JSON strings at the integration level (unit tests exist in lineReader)
4. Concurrent sessions with isolated event routing
5. Startup banner / non-JSON output before first valid JSON
6. Process crash → restart → pending drain → queue order preserved
7. **Out-of-order event delivery:** `tool_execution_end` arriving before `tool_execution_start` (F2.5)

- [ ] **Step 1: Enhance mockRpcServer.ts**

Add mock scenarios:
- `dual-tools`: emit tool1_start → tool2_start → tool1_end → tool2_end → agent_end events
- `chunks`: emit a JSON response split across 3 writes (partial JSON in each write)
- `banner`: emit 2 non-JSON lines (startup banner) before first valid response
- `multi-session`: accept `__session__` control command to set active session context
- `out-of-order`: emit `tool_execution_end` for callId "tool-1" before `tool_execution_start` for "tool-1" (the end arrives first, then the start)

- [ ] **Step 2: Write `rpc-event-stream.test.ts`**

Test scenarios:
1. Normal stream: agent_start → message_start → text_delta → message_end → agent_end
2. Dual tool interleaved: tool1_start → tool2_start → tool1_end → tool2_end (no cross-talk)
3. Duplicate agent_end → idempotent (no crash)
4. Compaction events interleaved with tool events
5. Empty stream handling (no events before response)
6. Partial JSON chunk reassembled across 3 writes (must match `id` correctly)
7. U+2028 U+2029 inside JSON strings (at integration level, not just unit)
8. **Out-of-order event delivery:** `tool_execution_end` for "tool-1" arrives before `tool_execution_start` for "tool-1". Verify: the end is silently dropped, and when the start later arrives, it creates a stuck "running" indicator. Document this as a known limitation.

- [ ] **Step 3: Add concurrent session isolation test (modify rpc-commands.test.ts)**

Add one test that verifies two PiRpcClient instances running side-by-side don't cross events.

- [ ] **Step 4: Add multi-write partial JSON test (modify rpc-protocol.test.ts)**

Add test for `chunks` scenario where a single JSON response is split across multiple `writeLine` calls from the mock server. The reader must reassemble correctly.

- [ ] **Step 5: Run all integration tests**

```bash
npm run test:integration
# Expected: 37-42 integration tests (29 existing + 8-13 new)
```

- [ ] **Step 6: Commit**

```bash
git add test/integration/ && git commit -m "test: extend integration tests with event streams, chunks, U+2028, concurrency, out-of-order events"
```

---

### Task 1.4: Fix Broken Imports + Add Extracted Module Tests

**Files:**
- Modify: `test/unit/reduceMessages.test.ts` — update imports to AppState
- Create: `test/unit/appReducer.test.ts` — already in Task 1.1, verify
- Create: `test/unit/ContextBuilder.test.ts`
- Create: `test/unit/ChangeTracker.test.ts`

- [ ] **Step 1: Verify reduceMessages.test.ts imports**

After Task 1.1, confirm all 19 tests pass with updated `from "../../src/ui/AppState"` imports.

```bash
npm run test:unit
# Should show 75+ tests passing
```

- [ ] **Step 2: Write ContextBuilder unit tests**

Test `getFileSuggestions()`:
1. Calls findFiles with correct exclude pattern
2. Returns empty array when no workspace is open
3. Includes open editor tabs not in workspace
4. Filters duplicates

- [ ] **Step 3: Write ChangeTracker unit tests**

Test:
1. `recordEvent` with edit tool → adds change
2. `recordEvent` with bash tool → no change recorded
3. `summarize()` returns formatted string and clears list
4. Multiple changes summarized correctly
5. Empty change list → empty string

- [ ] **Step 4: Run full test suite**

```bash
npm run compile && npm run test:unit && npm run test:integration && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add test/unit/ && git commit -m "test: add ContextBuilder and ChangeTracker unit tests with fixed imports"
```

---

## Phase 2: Fill Untested Modules

### Task 2.1: SessionManager + DiffController + Configuration + PiSession Unit Tests

**Files:**
- Create: `test/unit/SessionManager.test.ts`
- Create: `test/unit/DiffController.test.ts`
- Create: `test/unit/Configuration.test.ts`
- Create: `test/unit/PiSession.test.ts`

- [ ] **Step 1: Write SessionManager.test.ts**

Test (8 scenarios):
1. `create()` → creates PiSession, sets active, persists tabs
2. `create()` at maxConcurrent (default 3) → throws
3. `close()` → disposes session, removes from list, pushes to closed stack, persists
4. `setActive(id)` → updates activeId, fires onDidChange
5. `forkActive()` → creates new session with parent=active.id
6. `restoreSaved()` → re-creates from persisted tab IDs
7. `reopenLastClosed()` → pops from closed stack, creates new session
8. `getSessionRoot(id)` → returns per-session workspaceRoot (F-111)

Dependency injection: Use a mock `PiSession` factory so tests don't spawn real subprocesses. SessionManager takes a `createSession: () => PiSession` factory function.

- [ ] **Step 2: Write DiffController.test.ts**

Test (6 scenarios):
1. `onEvent` with `tool_execution_start` → snapshot file content
2. `onEvent` with `tool_execution_end` → opens diff editor
3. `acceptCurrent()` → no-op (keep current file), clears state
4. `revertCurrent()` → restores snapshot, sends steer to agent
5. Conflict detection: file mtime changed between snapshot and revert → warning, not silent overwrite
6. `acceptCurrent()` with no pending diff → no-op (doesn't throw)

- [ ] **Step 3: Write Configuration.test.ts**

Test (6 scenarios):
1. Read `permissionMode` from settings → returns correct string
2. `extraArgs()` includes provider, model, session-dir when set
3. `cwd()` with workspaceRoot override → returns root
4. `cwd()` without override → returns workspace root
5. `maxConcurrentSessions` clamped to minimum 1
6. `onDidChange` fires when `pi.*` settings change

Use `vscode.WorkspaceConfiguration` mock (test utility can patch `vscode.workspace.getConfiguration`).

- [ ] **Step 4: Write PiSession.test.ts**

Test (4 scenarios):
1. Construction sets up PiRpcClient with correct args
2. `prompt()` delegates to `client.prompt()`
3. `abort()` delegates to `client.abort()`
4. `dispose()` delegates to `client.dispose()` and cleans up state

- [ ] **Step 5: Run all tests**

```bash
npm run compile && npm run test:unit && npm run test:integration
```

- [ ] **Step 6: Commit**

```bash
git add test/unit/ && git commit -m "test: add SessionManager, DiffController, Configuration, PiSession tests"
```

---

### Task 2.2: ChatProvider Dispatch Tests (Success + Error Paths)

**Files:**
- Create: `test/unit/ChatProvider.test.ts`

**Note:** After Task 1.2 decomposition, ChatProvider is a coordinator. Its dispatch method is the main logic worth testing.

- [ ] **Step 1: Write success-path dispatch tests**

Cover every branch (14 scenarios):
1. `prompt` kind → calls `s.prompt()` with text + images
2. `steer` kind → calls `s.steer()`
3. `abort` kind → calls `s.abort()`
4. `setModel` → calls `s.setModel()` + `pushState()`
5. `cycleModel` → calls `s.cycleModel()` + `pushState()`
6. `setThinkingLevel` → calls `s.setThinkingLevel()` + `pushState()`
7. `login` → calls `s.prompt("/login")`
8. `logout` → calls `s.prompt("/logout")`
9. `acceptDiff` → calls `diff.acceptCurrent()`
10. `rejectDiff` → calls `diff.revertCurrent()`
11. `requestFileSuggestions` → triggers pushFileSuggestions
12. `removeContextItem` → triggers pushContext
13. Unknown kind → no-op (defensive)
14. No active session → silently drops message

- [ ] **Step 2: Write error-path dispatch tests (F2.4)**

Add 3 error-path scenarios:
1. **`s.prompt()` rejects** (e.g., pi CLI subprocess crashed): Verify that `vscode.window.showErrorMessage` is called with the error message, and that the dispatch does not re-throw.
2. **`diff.acceptCurrent()` throws** (e.g., file not found): Verify that the error is caught and `showErrorMessage` is called, rather than crashing the dispatch loop.
3. **`autosaveFiles` save fails** (e.g., workspace not writable): Verify that `prompt` is still called after the failed save, and the error from save doesn't swallow the prompt.

```typescript
// Test structure example:
it("handles s.prompt() rejection gracefully", async () => {
  const mockSession = createMockSession({ prompt: async () => { throw new Error("RPC timeout"); }});
  const mockShowError = sinon.stub(vscode.window, "showErrorMessage");
  const chatProvider = new ChatProvider(ctx, mockSessionManager, mockDiff);

  await chatProvider["dispatch"]({ kind: "prompt", text: "hello", images: [] });

  assert(mockShowError.calledOnceWith(sinon.match("RPC timeout")));
});
```

- [ ] **Step 3: Write pushFileSuggestions with mock workspace test**

Test that when `onDidOpenTextDocument` fires, pushFileSuggestions is triggered and calls `postToWebview` with the right shape.

- [ ] **Step 4: Run tests**

```bash
npm run compile && npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add test/unit/ChatProvider.test.ts && git commit -m "test: ChatProvider dispatch tests (14 success + 3 error-path scenarios)"
```

---

## Phase 3: Missing Delivery Features (Extension-Feasible)

### Task 3.1: Sensitive Command Detection (F-512) + Permission Mode Migration (F2.1/F2.7)

**Files:**
- Create: `src/security/commandClassifier.ts`
- Modify: `src/settings/Configuration.ts` — add `permissionMode` with migration, 4 spec modes + hidden bypass
- Modify: `package.json` — update `pi.permissionMode` enum atomically
- Modify: `src/view/ChatProvider.ts` — wire classification into dispatch

**CRITICAL (F2.1 fix):** The existing `"off"` value in `pi.permissionMode` must be handled BEFORE the enum changes. Users with `"off"` in their settings will get `undefined` which defaults to `"auto"` — a security downgrade. The migration must map `"off"` → `"readonly"` with a one-time notification.

- [ ] **Step 1: Read existing validation.ts**

```bash
cat src/security/validation.ts
```

Note: `isSensitiveFile()` and `resolveSafePath()` already exist. The command classifier must reuse these, not duplicate them.

- [ ] **Step 2: Implement `commandClassifier.ts`**

```typescript
export type CommandRisk = "safe" | "sensitive" | "dangerous";

export interface Classification {
  risk: CommandRisk;
  reason?: string;
}

export function classifyCommand(cmd: string): Classification {
  // Dangerous patterns (always confirm, even in auto/edit mode):
  //   rm -rf /, sudo, chmod 777 /, dd, mkfs, git push --force, pipe-to-curl|sh
  // Sensitive patterns (confirm in manual mode, auto-allow in auto/edit):
  //   rm (non-recursive), mv, chmod/chown, docker rm, git reset/rebase, npm publish, pip install
  // Safe: everything else (no confirm needed)
}
```

**EXPLICIT NOTE:** This classifier uses token-based pattern matching. It is trivially bypassed by compound commands (`rm -rf / && echo done`), shell obfuscation (`rm -rf /` as base64), or indirect execution (scripts). **This is a best-effort UX guardrail, not a security boundary.** Users who require real security should set `permissionMode` to `"manual"` and review every command. No security boundary claim is made for this classifier.

- [ ] **Step 3: Migrate permission mode (F2.1 fix) with backward compatibility (F2.7)**

**Migration table:**

| Old Value | New Value | Behavior |
|-----------|-----------|----------|
| `"off"` | `"readonly"` | Old "off" (block all) → new spec "readonly". **Migration: write `"readonly"` to user settings on first activation.** |
| `"manual"` | `"manual"` | Same — prompt for everything |
| `"auto"` | `"auto"` | Same — auto-allow safe/sensitive, prompt for dangerous |
| — | `"plan"` | New spec mode: allow reads, block writes/dangerous commands |
| — | `"bypass"` | Hidden 5th option (matches existing ModesMenu.tsx code). Skip all checks. |

**Implementation:**

```typescript
// In Configuration.ts:
// private migrated = false;

get permissionMode(): "readonly" | "plan" | "manual" | "auto" | "bypass" {
  const raw = this.cfg().get<string>("permissionMode");

  // F2.1: Migration from old "off" to new "readonly"
  if (raw === "off") {
    if (!this.migrated) {
      this.migrated = true;
      // One-time migration: silently update the stored value.
      // The user's intent ("block all dangerous ops") maps to "readonly".
      this.cfg().update("permissionMode", "readonly", vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        "Pi Code: Permission mode 'off' has been renamed to 'readonly'. " +
        "Your setting has been migrated automatically."
      );
    }
    return "readonly";
  }

  // Validate against allowed enum
  if (raw === "plan" || raw === "manual" || raw === "auto" || raw === "bypass") {
    return raw;
  }
  return "auto"; // default
}
```

**package.json schema update (F2.7):** Update the enum in the same commit:

```json
"pi.permissionMode": {
  "type": "string",
  "default": "auto",
  "enum": ["readonly", "plan", "manual", "auto"],
  "description": "Permission mode: 'readonly' (block all writes), 'plan' (read-only exploration), 'manual' (confirm each action), 'auto' (auto-allow with safety checks)."
}
```

Note: `"bypass"` is intentionally not in the schema — it's a hidden value settable only via direct settings.json edit.

- [ ] **Step 4: Wire into dispatch**

In `ChatProvider.dispatch()`, before executing prompt/steer, classify the command. If risk level exceeds the mode's threshold, either:
- Reject with error message in webview
- Show confirmation dialog (vscode.window.showWarningMessage)

- [ ] **Step 5: Add unit tests**

8 test cases for classifier:
1. `rm -rf /` → dangerous
2. `sudo apt install` → dangerous
3. `rm file.txt` → sensitive
4. `mv old new` → sensitive
5. `ls -la` → safe
6. `git log` → safe
7. `pip install requests` → sensitive
8. Empty string → safe

3 test cases for migration:
1. `"off"` in settings → returns `"readonly"`, calls `update("readonly")`, shows notification
2. `"auto"` in settings → returns `"auto"`, no migration
3. `undefined` in settings → returns `"auto"` (default)

- [ ] **Step 6: Run tests and build**

```bash
npm run compile && npm run test:unit && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/security/ src/settings/ package.json && git commit -m "feat: sensitive command detection (F-512) with permission mode migration (off→readonly)"
```

---

### Task 3.2: Command Preview (F-502) + Persisted Audit Log (F-513, F2.2)

**Files:**
- Modify: `src/view/ChatProvider.ts` — add preview before executive commands
- Create: `src/security/auditLog.ts` — JSONL-persisted audit log
- Create (or use existing): output channel for log flushing

- [ ] **Step 1: Implement `auditLog.ts` with JSONL persistence (F2.2 fix)**

```typescript
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface AuditEntry {
  timestamp: string;
  kind: "command" | "file_write" | "file_delete" | "permission_elevation" | "config_change";
  detail: string;
  risk?: string;
  authorized: boolean;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private maxMemoryEntries = 1000;
  private logPath: string;
  private writeStream: fs.WriteStream | null = null;

  constructor(storagePath: string) {
    // JSONL file in globalStoragePath for persistence across sessions
    this.logPath = path.join(storagePath, "audit.jsonl");
    // Ensure directory exists
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Open append stream
    this.writeStream = fs.createWriteStream(this.logPath, { flags: "a" });
  }

  record(entry: Omit<AuditEntry, "timestamp">): void {
    const fullEntry: AuditEntry = { timestamp: new Date().toISOString(), ...entry };
    this.entries.push(fullEntry);
    if (this.entries.length > this.maxMemoryEntries) this.entries.shift();
    // Persist to JSONL immediately
    if (this.writeStream) {
      this.writeStream.write(JSON.stringify(fullEntry) + "\n");
    }
  }

  dump(): AuditEntry[] { return [...this.entries]; }

  /** Write all entries to output channel for UI display. */
  flushToOutput(channel: vscode.OutputChannel): void {
    for (const entry of this.entries) {
      channel.appendLine(JSON.stringify(entry));
    }
  }

  /** Read full audit history from disk (for long-term retrieval). */
  readAll(): AuditEntry[] {
    try {
      const data = fs.readFileSync(this.logPath, "utf-8");
      return data.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [...this.entries];
    }
  }

  dispose(): void {
    this.writeStream?.end();
  }
}
```

**Scope note (F-513):** This audit log captures all extension-layer actions (command execution, file writes, config changes). It does NOT capture pi CLI internal operations (agent decisions, LLM calls, tool execution within the subprocess) because those happen inside the pi CLI subprocess which Pi Code does not control. Full audit coverage (S-015) requires pi CLI to emit audit events via the RPC protocol, or to write its own audit log accessible to the extension.

This implementation persists to `globalStoragePath/audit.jsonl`. For security-conscious users, this file should be added to `.gitignore` of any repository that has a `.vscode/` folder. The file is human-readable JSONL, not encrypted — no secrets should be written to it (sanitization is applied in Task 3.3).

- [ ] **Step 2: Wire audit into ChatProvider dispatch**

Record an entry before and after each dispatch action. On `turn_end`, flush to output channel.

- [ ] **Step 3: Add command preview in webview (F-502)**

In ChatProvider, before executing a command whose risk is "dangerous" or mode is "manual", send a preview message to the webview:

```typescript
postToWebview(wv.webview, { kind: "commandPreview", command: msg.text, risk: classification.risk, reason: classification.reason });
```

The webview renders a confirmation card before the command is sent. User confirms → dispatch continues. User cancels → no-op.

(This is a minimal preview — the full F-502 spec showing working directory and risk level is a stretch beyond this basic implementation.)

- [ ] **Step 4: Add unit tests**

6 test cases for audit log:
1. Record entry → appears in dump
2. Overflow to 1001 entries → oldest evicted from in-memory
3. Persisted entry → readable from disk via readAll()
4. flushToOutput calls channel.appendLine
5. Wire into dispatch: prompt produces audit entry
6. dispose() closes write stream cleanly

- [ ] **Step 5: Commit**

```bash
git add src/security/auditLog.ts src/view/ && git commit -m "feat: command preview (F-502) and persisted audit log (F-513)"
```

---

### Task 3.3: Config Sanitization at Entry Point (S-002, F2.6) + @-Mention Sanitization (KI-001, F2.8)

**Files:**
- Modify: `src/settings/Configuration.ts` — apply sanitizeLogMessage inside each getter
- Modify: `src/view/ChatProvider.ts` — sanitize log calls
- Modify: `src/ui/App.tsx` or `src/ui/InputArea.tsx` — sanitize @-mention display text (KI-001)

- [ ] **Step 1: Apply sanitization at Configuration getter level (F2.6 fix)**

Previously, sanitization was only applied when values were written to the output channel. This left a window where unsanitized values could leak through webview pushState, error messages, or before sanitization was applied in individual log calls.

Fix: Call `sanitizeLogMessage` inside each Configuration getter that handles user-supplied strings:

```typescript
import { sanitizeLogMessage } from "../security/validation";

get sessionDir(): string | undefined {
  const v = this.cfg().get<string>("sessionDir") || "";
  if (!v) return undefined;
  // ... template substitution ...
  return sanitizeLogMessage(v); // sanitize at point of entry
}

get executable(): string {
  return sanitizeLogMessage(this.cfg().get<string>("path") || "pi");
}
```

Note: The `permissionMode` getter (already returning an enum value, not user data) and `maxConcurrentSessions` (number, not string) do not need sanitization. Only string-typed getters that accept freeform user input need it:

- `executable` (string — user could type any path)
- `sessionDir` (string — workspace path with possible PII)
- `defaultProvider` (string — provider name; low risk but sanitize defensively)
- `defaultModel` (string — model name; low risk but sanitize defensively)
- `fileSuggestionsExclude` (string → array — glob patterns, no risk)

**Scope note (S-002):** This sanitization protects settings.json display, log output, and webview rendering. It does NOT cover session files written by the pi CLI subprocess (`~/.pi/agent/sessions/*.jsonl`), as those are managed by the external `pi` binary. pi CLI session files are out of scope for extension-layer sanitization.

- [ ] **Step 2: Sanitize in ChatProvider logs**

Review all `this.ctx.log()` calls in ChatProvider for potential sensitive data exposure. Apply `sanitizeLogMessage`:

```typescript
// Before:
this.ctx.log("error", `pushState failed: ${(err as Error).message}`);
// After:
this.ctx.log("error", `pushState failed: ${sanitizeLogMessage((err as Error).message)}`);
```

- [ ] **Step 3: Sanitize @-mention display text (KI-001 fix, F2.8)**

In InputArea.tsx or wherever @-mention suggestions are rendered, apply sanitization to file paths and symbol names before displaying them:

```typescript
// In @-mention autocomplete display:
{suggestions.map((s) => (
  <div key={s.path}>{sanitizeDisplayText(s.path)}</div>
))}
```

Where `sanitizeDisplayText()` is a lightweight function that:
- Preserves normal file path characters
- Replaces/escapes characters that could be misinterpreted by downstream processing (though React JSX + CSP already prevents HTML injection, this is defense-in-depth)
- Specifically handles: path traversal symbols, null bytes, control characters

```typescript
export function sanitizeDisplayText(text: string): string {
  // Strip null bytes and control characters (except newline/tab)
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // React JSX auto-escapes HTML entities, CSP blocks inline scripts.
  // This is defense-in-depth, not a security boundary.
}
```

**Note (KI-001 severity):** The original finding rates this Medium. In practice, React JSX auto-escapes HTML entities and the strict CSP blocks inline scripts, so exploitation via @-mention display is not feasible. This fix raises the bar further but is primarily a defense-in-depth measure.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix: sanitize config values at entry point (S-002) and @-mention display (KI-001)"
```

---

### Task 3.4: Environment Inheritance (F-511)

**Files:**
- Modify: `src/settings/Configuration.ts` — add `inheritEnv` setting
- Modify: `src/rpc/PiRpcClient.ts` — use env inheritance config

- [ ] **Step 1: Add `inheritEnv` and `extraEnv` settings to Configuration**

```typescript
// In Configuration class:
get inheritEnv(): boolean {
  return this.cfg().get<boolean>("inheritEnv") ?? true;
}

get extraEnv(): Record<string, string> {
  const raw = this.cfg().get<Record<string, string>>("extraEnv") ?? {};
  return raw;
}
```

- [ ] **Step 2: Wire into PiRpcClient.start()**

When `inheritEnv` is true (default), merge `process.env` with any `extraEnv` overrides (current behavior). When false, only pass explicitly set environment variables.

```typescript
// In PiRpcClient.start():
const childEnv = this.opts.inheritEnv
  ? { ...process.env, ...this.opts.env }
  : { ...this.opts.env };
```

- [ ] **Step 3: Add unit tests**

3 test cases:
1. `inheritEnv=true`: child gets parent env + overrides
2. `inheritEnv=false`: child gets only explicit env
3. `extraEnv` values override parent env correctly

- [ ] **Step 4: Commit**

```bash
git add src/settings/ src/rpc/ && git commit -m "feat: environment inheritance control (F-511)"
```

---

### Task 3.5: Multi-Position Display (F-004) — Stretch

**Files:**
- Modify: `src/view/ChatProvider.ts` — optionally create WebviewPanel instead of WebviewView
- Add configuration: `pi.chatPosition` = `"sidebar"` | `"tab"` | `"secondary"`

- [ ] **Step 1: Add `pi.chatPosition` setting**

- [ ] **Step 2: In ChatProvider, when position !== "sidebar", create WebviewPanel**

Extract `buildHtml()` and event wiring so they work for both WebviewView and WebviewPanel.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: multi-position chat display (F-004)"
```

---

## Phase 4: Performance

### Task 4.1: FileSystemWatcher for File Suggestions (was Debounce)

**Files:**
- Modify: `src/view/ChatProvider.ts` (or `src/view/ContextBuilder.ts` after Task 1.2)

**Problem:** The original plan proposed 500ms debounce on `onDidOpenTextDocument`. But the real cost is `findFiles` which re-scans the workspace on every file open.

**Fix:** Replace `onDidOpenTextDocument` with `vscode.workspace.createFileSystemWatcher` watching only the workspace root. Cache file list, and only re-scan when the folder structure changes (files added/deleted), not every time a file is merely opened.

- [ ] **Step 1: Code-path analysis (replaces measurement — F2.3 fix)**

Instead of measuring `findFiles` timing (which requires running a VS Code extension with a real workspace — impossible for an agent), determine by static analysis:

The current `pushFileSuggestions()` calls `vscode.workspace.findFiles("**/*", excludePattern, 200)` every time:
- A text document is opened (`onDidOpenTextDocument`)
- Workspace folders change (`onDidChangeWorkspaceFolders`)
- The webview becomes visible (`onDidChangeVisibility`)

The `findFiles` call is the dominant cost. It scans the workspace filesystem on every invocation. In a workspace with 10K+ files even with the exclude pattern, this can take 200-500ms.

The frequency: every file open triggers this. A developer navigating between files (common operation) could trigger 10+ scans per minute.

**Decision rule:** If `findFiles` is called more than once per 5 seconds on average during normal file navigation → FileSystemWatcher is justified. The code shows it is called on EVERY `onDidOpenTextDocument`, so it IS called at that frequency. Proceed with the fix.

- [ ] **Step 2: Implement FileSystemWatcher + cache**

```typescript
// Replace:
vscode.workspace.onDidOpenTextDocument(() => void this.pushFileSuggestions())

// With:
const watcher = vscode.workspace.createFileSystemWatcher("**/*");
watcher.onDidCreate(() => void this.pushFileSuggestions());
watcher.onDidDelete(() => void this.pushFileSuggestions());
// Note: onDidChange is NOT watched — opening a file fires change, not create/delete.
// Cache the file list and reuse it across calls, only refreshing on create/delete.
this.disposables.push(watcher);
```

```typescript
private suggestionsCache: { files: FileSuggestion[]; timestamp: number } | null = null;
private readonly CACHE_TTL_MS = 30_000;

private async pushFileSuggestions(): Promise<void> {
  if (this.suggestionsCache && Date.now() - this.suggestionsCache.timestamp < this.CACHE_TTL_MS) {
    postToWebview(/* use cache */);
    return;
  }
  // ... existing findFiles logic ...
  this.suggestionsCache = { files, timestamp: Date.now() };
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "perf: replace debounce with FileSystemWatcher + cache for file suggestions"
```

---

### Task 4.2: Virtual Scrolling Investigation + KI-006 Deferral (F2.8)

**Files:** Read-only investigation. Add note to `docs/known-issues.md`.

- [ ] **Step 1: Check actual DOM size**

The `reduceMessages` function already truncates at 200 messages and 50K chars per message. 200 * average message DOM node count * 50KB worst case. If the existing truncation keeps DOM under 5MB, virtual scrolling is unnecessary for v0.2.0. Document as a v0.3.0 consideration.

- [ ] **Step 2: Add known-issues entry for virtual scrolling**

Add a new Low finding: "DOM size with 200 messages near the text limit could reach ~10MB. Mitigated by message count and per-message truncation. Virtual scrolling deferred to v0.3.0."

- [ ] **Step 3: Document KI-006 deferral (F2.8)**

KI-006 (terminal shell support) is deferred because:
1. The feature is off by default (`pi.enableTerminalIntegration: false`)
2. The VS Code shell integration API is owned by VS Code, not Pi Code
3. Supporting fish/other shells would require forking VS Code's shell integration logic
4. The agent works correctly without this feature — the terminal view is a supplementary display

Add to known-issues.md KI-006 entry: "Deferred to v0.3.0. Works correctly on zsh (macOS/Linux) and PowerShell (Windows). Requires VS Code shell integration API to add other shells."

- [ ] **Step 4: Commit**

```bash
git commit -am "docs: add virtual scrolling consideration and KI-006 deferral to known issues"
```

---

## Phase 5: Engineering Excellence

### Task 5.1: Pre-Commit Hook + CI Integration

**Files:**
- Modify: `.husky/pre-commit` — run format:check + lint + test:unit

- [ ] **Step 1: Initialize husky**

```bash
npx husky init
```

- [ ] **Step 2: Configure pre-commit hook**

```bash
echo "npm run format:check && npm run lint && npm run test:unit" > .husky/pre-commit
```

- [ ] **Step 3: Commit**

```bash
git add .husky/ && git commit -m "chore: add pre-commit hook for format/lint/test"
```

---

### Task 5.2: Update delivery-checklist.md + known-issues.md

- [ ] **Step 1: Update delivery-checklist.md** to reflect actual Phase 0-5 completion status

Update status labels from `⚡[Planned: Phase X.Y]` to `✅` or `⚠️` as appropriate after each task completes.

- [ ] **Step 2: Update known-issues.md**

Add any new issues found during implementation. Update KI-001 and KI-006 entries to reflect completed work or explicit deferral.

- [ ] **Step 3: Run final full build and test**

```bash
npm run compile && npm run test:unit && npm run test:integration && npm run build
```

- [ ] **Step 4: Final commit**

```bash
git commit -am "v0.2.1: final improvement plan delivery"
```

---

### Task 5.3: Update TECH_DESIGN.md for Architecture Changes (F2.11)

**Files:**
- Modify: `TECH_DESIGN.md` (at project root)

**What changed that TECH_DESIGN.md must reflect:**

1. **App.tsx architecture:** Replace the `useState` god-object description with the new `useReducer` + `AppState`/`AppAction` design. Update the Webview UI section (3.4) to reflect extracted `WelcomeScreen.tsx` and `InputArea.tsx`.

2. **ChatProvider decomposition:** Update the module table (1.1) to include the three new modules:
   - `src/view/ContextBuilder.ts` — context assembly
   - `src/view/GitStatusReader.ts` — Git status reading
   - `src/view/ChangeTracker.ts` — change tracking for F-414

3. **Security section (4):** Add:
   - `commandClassifier.ts` with `CommandRisk` types and `classifyCommand()` function
   - Permission mode migration table (off→readonly) and the 4-mode enum
   - Note that the classifier is a UX guardrail, not a security boundary

4. **Storage section (5):** Add `auditLog` with JSONL persistence in `globalStoragePath`

5. **Dependency graph (6):** Update to show new module relationships

- [ ] **Step 1: Read TECH_DESIGN.md**

```bash
cat TECH_DESIGN.md
```

- [ ] **Step 2: Update architecture diagram**

Add new modules in the ChatProvider section of the diagram:
```
┌──────────────┐
│  Chat        │
│  Provider    │
│  ┌──────────┐│
│  │ Context   ││
│  │ Builder   ││
│  ├──────────┤│
│  │ GitStatus ││
│  │ Reader    ││
│  ├──────────┤│
│  │ Change    ││
│  │ Tracker   ││
│  └──────────┘│
└──────────────┘
```

- [ ] **Step 3: Update Webview UI section (3.4)**

Replace the useState description with useReducer:

```
App.tsx (useReducer)
 ├── AppState (appReducer + actions)
 ├── WelcomeScreen
 ├── MessageList / MessageItem
 └── InputArea
```

- [ ] **Step 4: Add command classifier and audit log to security section**

Add new subsection 4.5 and 4.6 documenting the classifier and audit log, with the explicit guardrail note.

- [ ] **Step 5: Commit**

```bash
git add TECH_DESIGN.md && git commit -m "docs: update TECH_DESIGN.md for useReducer, ChatProvider decomposition, command classifier, audit log"
```

---

## Global Constraints

- All tests must pass before commits
- No new external runtime dependencies (devDependencies OK)
- VS Code ^1.85.0 backward compatibility
- Must maintain support for macOS Apple Silicon, Windows 11 x64, Ubuntu 24.04 x64
- All existing 75 unit tests must continue to pass
- F-410/411/412 (auto-open, locate, highlight) must remain intact
- CSP `default-src 'none'` must not be weakened
- postMessage kind whitelist must remain intact
- Any task that changes file imports (Task 1.1 especially) must update all dependent test files atomically
- Tasks blocked on pi CLI RPC protocol (listed in Task 0.1) must NOT be attempted at the extension layer
- **CRITICAL:** Permission mode migration (`"off"` → `"readonly"`) must be applied before any other permission-related code change, to avoid an intermediate state where `"off"` users silently get `"auto"` behavior
- The command classifier is a **UX guardrail**, not a security boundary — do not claim or imply otherwise in documentation or code comments
- Config sanitization is applied at the Configuration getter level (point of entry), not just at log output
- pi CLI session file sanitization (written by the external `pi` binary) is **out of scope** for extension-layer sanitization
