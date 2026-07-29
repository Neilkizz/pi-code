# Pi Code Improvement Plan — REVISED

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Systematically improve Pi Code VS Code extension from v0.2.0 to production-ready, addressing test gaps, code quality, missing delivery features, and architectural debt — grounded in the actual state of the codebase and the RPC protocol boundary.

**Architecture:** Five-layer decoupled extension (Extension Host → Session Manager → PiRpcClient → pi CLI subprocess) with React webview UI.

**Tech Stack:** TypeScript 5, React 18, VS Code API ^1.85.0, Webpack 5, Mocha 10, Node >=18

## Critique Response

| # | Finding | Verdict | Rationale |
|---|---------|---------|-----------|
| F1 | pi CLI RPC protocol gap | **ACCEPT** | ~20 delivery items blocked on pi CLI RPC. Phase 0 catalogs these. Plan was optimizing a bridge to nowhere. |
| F2 | Task 1 duplicates existing tests | **ACCEPT** | 5 integration files (29 tests, 634 lines) already exist. Any new tests must pass inventory first. |
| F3 | App.tsx misdiagnosis | **ACCEPT** | 13 useState vars + God switch is the real problem, not file size. Replaced with useReducer refactoring. |
| F4 | ChatProvider.ts (419 lines) untouched | **ACCEPT** | Larger monolith than App.tsx, manages 5-6 responsibilities. New ChatProvider decomposition task added. |
| F5 | 70% coverage is a guess | **ACCEPT** | No instrumented report. ChatProvider/SessionManager/DiffController/Configuration/PiSession have zero tests (1717 LOC). |
| F6 | RPC tests ignore real pi CLI | **PARTIAL** | Integration tests correctly test extension code with mock server. A separate contract test against real pi CLI is valuable but lower priority. Added as stretch task. |
| F7 | Debounce misplaced | **ACCEPT** | 500ms debounce is a band-aid; "checksum workspace root mtime" unimplementable. Replaced with FileSystemWatcher approach. |
| F8 | 7 missing delivery items | **ACCEPT** | F-405/S-009 blocked on pi CLI. F-511/F-004/S-002/F-502/F-513 are extension-layer and added. |
| F9 | Command classifier duplicates | **ACCEPT** | validation.ts (96 lines) already exists. New classifier must reuse it, not duplicate. Permission mode vocabulary aligned to existing 5-mode system. |
| F10 | Unstated dependencies | **ACCEPT** | Added explicit dependency graph. Task 3 (now 1.1) will break reduceMessages imports — tests must be updated in lockstep. |
| F11 | Husky causes inconsistent formatting | **ACCEPT** | Formatting moved to Phase 0, pre-commit hook to Phase 1. |
| F12 | Underspecified steps | **ACCEPT** | All implementation steps are now buildable by someone reading the plan cold. No "checksum mtime" or "wire into" vagueness. |
| F13 | WelcomeScreen extraction low value | **PARTIAL** | It's a necessary sub-step of the larger useReducer refactoring, but not a standalone win. Framed as mechanical step within the architecture task. |
| F14 | No virtual scrolling strategy | **PARTIAL** | reduceMessages already truncates at 200 msgs/50K chars per message. Long-term concern noted but not blocking. Added stretch note. |
| F15 | Missing npm test:integration script | **REJECT** | Script exists in package.json (verified). Critique was incorrect on this point. No action needed. |

---

## Dependency Graph

```
Phase 0: Context Assessment (parallel, no deps)
  0.1 ── RPC gap + blocked-item audit
  0.2 ── Test inventory + coverage baseline
  0.3 ── Formatting + linting setup

Phase 1: Architecture + Testing (depends on Phase 0)
  ┌─ 1.1 ── App.tsx useReducer refactoring (no deps on other Phase 1)
  │         BREAKS: test/unit/reduceMessages.test.ts imports — fix in step 1.4
  ├─ 1.2 ── ChatProvider decomposition (no deps on 1.1 — different process domain)
  ├─ 1.3 ── Extend integration tests (partial JSON, U+2028, dual tool, concurrent sessions)
  └─ 1.4 ── Fix broken imports from 1.1 + add unit tests for extracted modules

Phase 2: Fill Untested Modules (depends on 1.2 — ChatProvider must be decomposed first)
  2.1 ── SessionManager + DiffController + Configuration + PiSession unit tests
  2.2 ── ChatProvider dispatch tests (on decomposed version)

Phase 3: Missing Delivery Features (can start parallel with Phase 1 after 0.1)
  3.1 ── Command classifier (F-512) — reuse validation.ts
  3.2 ── Command preview (F-502) + audit log (F-513)
  3.3 ── Config sanitization (S-002)
  3.4 ── Environment inheritance (F-511)
  3.5 ── Multi-position display (F-004) — stretch

Phase 4: Performance (depends on Phase 1.3 — integration test harness)
  4.1 ── FileSystemWatcher for file suggestions
  4.2 ── Virtual scrolling note (investigation)

Phase 5: Engineering Excellence (depends on Phase 0.3 + Phase 2)
  5.1 ── Pre-commit hook + CI integration
  5.2 ── Remaining delivery item: cleanup
```

---

## Phase 0: Context Assessment

### Task 0.1: RPC Gap Inventory & Delivery Item Audit

**Files:** Read-only audit; output goes into the plan below
- Read: `docs/delivery-checklist.md`, `ROADMAP.md`, `交付标准.md`

**Goal:** Catalog which delivery items are blocked on pi CLI RPC vs. feasible in extension layer, so the remaining plan works on what it can actually deliver.

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

- [ ] **Step 3: Commit**

```bash
git add docs/ && git commit -m "docs: RPC gap inventory for delivery planning"
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

### Task 1.1: App.tsx useReducer Refactoring (was Task 3)

**Files:**
- Create: `src/ui/AppState.ts` — DisplayMessage type, reducer, actions
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
// UseReducer action union for all state transitions
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
  summarize(): string { const s = this.changes.map(...); this.changes = []; return s; }
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
- Modify: `test/integration/mockRpcServer.ts` — add dual-tool event sequences, partial JSON chunking
- Create: `test/integration/rpc-event-stream.test.ts`
- Modify: `test/integration/rpc-protocol.test.ts` — add U+2028, partial chunk tests

**Rationale:** The existing 29 integration tests cover lifecycle, commands, protocol garbage, and timeout. Missing:
1. Dual concurrent tool execution events (tool1_start → tool2_start → tool1_end → tool2_end)
2. Partial JSON chunk reassembly across multiple `data` events
3. U+2028/U+2029 inside JSON strings at the integration level (unit tests exist in lineReader)
4. Concurrent sessions with isolated event routing
5. Startup banner / non-JSON output before first valid JSON
6. Process crash → restart → pending drain → queue order preserved

- [ ] **Step 1: Enhance mockRpcServer.ts**

Add mock scenarios:
- `dual-tools`: emit tool1_start → tool2_start → tool1_end → tool2_end → agent_end events
- `chunks`: emit a JSON response split across 3 writes (partial JSON in each write)
- `banner`: emit 2 non-JSON lines (startup banner) before first valid response
- `multi-session`: accept `__session__` control command to set active session context

- [ ] **Step 2: Write `rpc-event-stream.test.ts`**

Test scenarios:
1. Normal stream: agent_start → message_start → text_delta → message_end → agent_end
2. Dual tool interleaved: tool1_start → tool2_start → tool1_end → tool2_end (no cross-talk)
3. Duplicate agent_end → idempotent (no crash)
4. Compaction events interleaved with tool events
5. Empty stream handling (no events before response)
6. Partial JSON chunk reassembled across 3 writes (must match `id` correctly)
7. U+2028 U+2029 inside JSON strings (at integration level, not just unit)

- [ ] **Step 3: Add concurrent session isolation test (modify rpc-commands.test.ts)**

Add one test that verifies two PiRpcClient instances running side-by-side don't cross events.

- [ ] **Step 4: Add multi-write partial JSON test (modify rpc-protocol.test.ts)**

Add test for `chunks` scenario where a single JSON response is split across multiple `writeLine` calls from the mock server. The reader must reassemble correctly.

- [ ] **Step 5: Run all integration tests**

```bash
npm run test:integration
# Expected: 35-40 integration tests (29 existing + 6-11 new)
```

- [ ] **Step 6: Commit**

```bash
git add test/integration/ && git commit -m "test: extend integration tests with event streams, chunks, U+2028, concurrency"
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

Test (5 scenarios):
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

### Task 2.2: ChatProvider Dispatch Tests

**Files:**
- Create: `test/unit/ChatProvider.test.ts`

**Note:** After Task 1.2 decomposition, ChatProvider is a coordinator. Its dispatch method is the main logic worth testing.

- [ ] **Step 1: Write ChatProvider dispatch tests**

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

Use mock `SessionManager`, `DiffController`, and `Configuration`.

- [ ] **Step 2: Write pushFileSuggestions with mock workspace test**

Test that when `onDidOpenTextDocument` fires, pushFileSuggestions is triggered and calls `postToWebview` with the right shape.

- [ ] **Step 3: Run tests**

```bash
npm run compile && npm run test:unit
```

- [ ] **Step 4: Commit**

```bash
git add test/unit/ChatProvider.test.ts && git commit -m "test: ChatProvider dispatch tests (14 scenarios)"
```

---

## Phase 3: Missing Delivery Features (Extension-Feasible)

### Task 3.1: Sensitive Command Detection (F-512)

**Files:**
- Create: `src/security/commandClassifier.ts`
- Modify: `src/settings/Configuration.ts` — add `permissionMode` 4-mode support (match spec: readonly/plan/manual/auto/edit)
- Modify: `src/view/ChatProvider.ts` — wire classification into dispatch

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

- [ ] **Step 3: Align permission modes with spec (4 modes)**

The spec requires 4 modes: `readonly`, `plan`, `manual`, `auto`. The code currently has 5: `auto`/`manual`/`off`/`plan`/`bypass` (from ModesMenu.tsx getModeIcon). Configuration.ts only allows 3: `off`/`manual`/`auto`.

Fix: Update `Configuration.permissionMode` to return the union of all 4 spec modes. Keep `bypass` as a hidden 5th option (matching existing UI code). Map internally:
- `readonly` → all file writes blocked
- `plan` → allow reads, block writes/dangerous commands
- `manual` → prompt for everything
- `auto` → allow safe/sensitive, prompt for dangerous
- `bypass` → allow everything (hidden, advanced setting)

- [ ] **Step 4: Wire into dispatch**

In `ChatProvider.dispatch()`, before executing prompt/steer, classify the command. If risk level exceeds the mode's threshold, either:
- Reject with error message in webview
- Show confirmation dialog (vscode.window.showWarningMessage)

- [ ] **Step 5: Add unit tests**

8 test cases:
1. `rm -rf /` → dangerous
2. `sudo apt install` → dangerous
3. `rm file.txt` → sensitive
4. `mv old new` → sensitive
5. `ls -la` → safe
6. `git log` → safe
7. `pip install requests` → sensitive
8. Empty string → safe

- [ ] **Step 6: Run tests and build**

```bash
npm run compile && npm run test:unit && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/security/ src/settings/ && git commit -m "feat: sensitive command detection (F-512) with aligned permission modes"
```

---

### Task 3.2: Command Preview (F-502) + Audit Log (F-513)

**Files:**
- Modify: `src/view/ChatProvider.ts` — add preview before executive commands
- Create: `src/security/auditLog.ts`
- Wire into existing output channel

- [ ] **Step 1: Implement `auditLog.ts`**

```typescript
export interface AuditEntry {
  timestamp: string;
  kind: "command" | "file_write" | "file_delete" | "permission_elevation" | "config_change";
  detail: string;
  risk?: CommandRisk;
  authorized: boolean;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries = 1000;

  record(entry: Omit<AuditEntry, "timestamp">): void {
    this.entries.push({ timestamp: new Date().toISOString(), ...entry });
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  dump(): AuditEntry[] { return [...this.entries]; }

  /** Write all entries to the Pi Code output channel. */
  flushToOutput(channel: vscode.OutputChannel): void { /* ... */ }
}
```

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

4 test cases for audit log:
1. Record entry → appears in dump
2. Overflow to 1001 entries → oldest evicted
3. flushToOutput calls channel.appendLine
4. Wire into dispatch: prompt produces audit entry

- [ ] **Step 5: Commit**

```bash
git add src/security/auditLog.ts src/view/ && git commit -m "feat: command preview (F-502) and audit log (F-513)"
```

---

### Task 3.3: Config Sanitization (S-002)

**Files:**
- Modify: `src/settings/Configuration.ts` — sanitize sensitive values before logging

- [ ] **Step 1: Review what values Configuration exposes**

Configuration currently reads: `executable`, `defaultProvider`, `defaultModel`, `sessionDir`, `maxConcurrentSessions`, `enableTerminalIntegration`, `autoReconnect`, `autosaveFiles`, `respectGitIgnore`, `permissionMode`, `fileSuggestionsExclude`, `autoOpenOnEdit`, `formatAfterEdit`.

None of these are secrets. S-002 is about ensuring that if a future setting stores API keys or tokens, they're sanitized. Apply defensively.

- [ ] **Step 2: Add sanitization to Configuration**

```typescript
import { sanitizeLogMessage } from "../security/validation";

// When logging Configuration values:
log("info", `Configuration: permissionMode=${this.permissionMode}, sessionDir=${sanitizeLogMessage(this.sessionDir ?? "(none)")}`);
```

Apply `sanitizeLogMessage` in any log call that includes config values that could contain paths or identifiers.

- [ ] **Step 3: Also sanitize in ChatProvider logs**

Review all `this.ctx.log()` calls in ChatProvider for potential sensitive data exposure. Apply sanitizeLogMessage.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix: sanitize configuration values in logs (S-002)"
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

- [ ] **Step 1: Measure current performance**

Before changing anything, instrument `pushFileSuggestions` with timing:

```bash
# Add a one-line console.time/timeEnd pair to measure findFiles duration
```

Typical small workspace: ~10ms. Large workspace (10K files): ~500ms. If <50ms on the target workspace, skip this task entirely.

- [ ] **Step 2: Only implement if justified by measurement**

If `findFiles` takes >100ms on a moderate workspace:

```typescript
// Replace:
vscode.workspace.onDidOpenTextDocument(() => void this.pushFileSuggestions())

// With:
const watcher = vscode.workspace.createFileSystemWatcher("**/*");
watcher.onDidCreate(() => void this.pushFileSuggestions());
watcher.onDidDelete(() => void this.pushFileSuggestions());
// Note: onDidChange is NOT watched — opening a file fires change, not create/delete.
// Cache the file list and reuse it across calls, only refreshing on create/delete.
```

- [ ] **Step 3: Add cache with TTL**

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

- [ ] **Step 4: Commit**

```bash
git commit -am "perf: replace debounce with FileSystemWatcher + cache for file suggestions"
```

---

### Task 4.2: Virtual Scrolling Investigation (Stretch)

**Files:** Read-only investigation. Add a note to `docs/known-issues.md` with findings.

- [ ] **Step 1: Check actual DOM size**

```bash
# The reduceMessages function already truncates at 200 messages and 50K chars per message
# 200 * average message DOM node count * 50KB worst case
```

If the existing truncation (200 messages, 50K chars per message) keeps DOM under 5MB, virtual scrolling is unnecessary for v0.2.0. Document as a v0.3.0 consideration.

- [ ] **Step 2: Add known-issues entry**

Add a new Low finding: "DOM size with 200 messages near the text limit could reach ~10MB. Mitigated by message count and per-message truncation. Virtual scrolling deferred to v0.3.0."

- [ ] **Step 3: Commit**

```bash
git commit -am "docs: add virtual scrolling consideration to known issues"
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

Note: pre-commit hook runs `format:check` (not `format --write`) so that developers explicitly format with a separate `npm run format` step. This avoids surprising reformatting during commits.

---

### Task 5.2: Remaining Delivery Item Cleanup

- [ ] **Step 1: Update delivery-checklist.md** to reflect actual Phase 0-5 completion status

- [ ] **Step 2: Update known-issues.md** with any new issues found during implementation

- [ ] **Step 3: Run final full build and test**

```bash
npm run compile && npm run test:unit && npm run test:integration && npm run build
```

- [ ] **Step 4: Final commit**

```bash
git commit -am "v0.2.1: final improvement plan delivery"
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
