# Pi Code Improvement Plan -- v4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Systematically improve Pi Code VS Code extension from v0.2.0 to production-ready, addressing test gaps, code quality, missing delivery features, architectural debt, and ALL known critique findings (29 issues from rounds 1-2 + 19 new issues from round 3 = 48 total).

**Architecture:** Five-layer decoupled extension (Extension Host -> Session Manager -> PiRpcClient -> pi CLI subprocess) with React webview UI.

**Tech Stack:** TypeScript 5, React 18, VS Code API ^1.85.0, Webpack 5, Mocha 10, Node >=18

---

## Round 3 Critique Response

| # | Finding | Severity | Verdict | Rationale |
|---|---------|----------|---------|-----------|
| CR-1 | Command preview flow incomplete -- no webview confirmation pathway | CRITICAL | **ACCEPT** | Added full round-trip design: (a) `commandPreview` type to HostToWebview, (b) `confirmCommand` + `cancelCommand` kinds to WebviewToHost, (c) `validKinds` update in decodeFromWebview, (d) async promise pattern in dispatch (stores pending resolve on `this`), (e) confirmation card in React. See Task 3.2. |
| CR-2 | ModesMenu already has "edit" mode that Configuration doesn't support | CRITICAL | **ACCEPT** | Reconcile PermissionMode across ModesMenu.tsx, Configuration.ts, package.json schema. Create single `PermissionMode` type in `src/types/permission.ts`. ModesMenu: replace `edit` with `readonly`. See Task 3.1 Steps 1-4. |
| CR-3 | Phase 3 tasks 3.1/3.2/3.3 marked parallel but all modify dispatch | CRITICAL | **ACCEPT** | Phase 3 tasks now sequential with explicit deps. All blocked on Task 1.2. Dependency graph corrected. |
| H-1 | mockRpcServer.ts has no tool execution events | HIGH | **ACCEPT** | Added `tool-events` scenario generating `tool_execution_start/end` with multiple toolCallId values. Out-of-order emits end-before-start. See Task 1.3 Step 1. |
| H-2 | PiSession.ts env wiring omitted | HIGH | **ACCEPT** | Added PiSession constructor step: read `config.inheritEnv` and `config.extraEnv`, pass to PiRpcClient. See Task 3.4 Step 2. |
| H-3 | Task 1.1 single 500+ line commit | HIGH | **ACCEPT** | Split into 3 commits: (A) AppState.ts + appReducer tests, (B) WelcomeScreen + InputArea, (C) App.tsx rewrite + import fixes. |
| H-4 | Task 0.3 formatting touches every file | HIGH | **ACCEPT** | Mass-format deferred to Task 5.4. Config uses `singleQuote: true` (zero diffs). `.prettierignore` added. |
| H-5 | Phase 3 has no integration tests for end-to-end flow | HIGH | **ACCEPT** | Added Task 3.6: integration test covering message->classify->preview->audit->execute. |
| H-6 | Virtual scrolling "read DOM" step unexecutable | HIGH | **ACCEPT** | Replaced with pure static analysis: read `reduceMessages` truncation constants (200 msgs, 50K chars/message), estimate ~10MB text + ~10K DOM nodes = ~10-15MB footprint. Deferred to v0.3.0. |
| M-1 | Audit log has no rotation | MEDIUM | **ACCEPT** | Added size check before each write: if >10MB, rotate to `.1`, keep 3 archives. Periodic flush every 30s. |
| M-2 | Task 1.2 missing import paths | MEDIUM | **ACCEPT** | Added explicit import statements for ChatProvider.ts after extraction. |
| M-3 | Task 0.2 no coverage tooling | MEDIUM | **ACCEPT** | Added c8 devDependency + `test:coverage` script. |
| M-4 | US-13 wording wrong in PRD table | MEDIUM | **ACCEPT** | Changed from "delivered in this plan" to "Enhanced in this plan". |
| M-5 | KI-006 no graceful degradation | MEDIUM | **ACCEPT** | Added shell detection on activation, one-time warning for unsupported shells. |
| M-6 | Task 1.2 & Phase 3 same code | MEDIUM | **ACCEPT** | Same as CR-3: Phase 3 blocks on Task 1.2 in dependency graph. |
| M-7 | No env integration test | MEDIUM | **ACCEPT** | Added `env-echo` mock scenario + integration test verifying env vars reach child. |
| L-1 | "Unknown action" tests TypeScript not logic | LOW | **ACCEPT** | Replaced with `as any` cast + explicit comment explaining the test simulates runtime. |
| L-2 | Task 0.2 commits existing test files | LOW | **ACCEPT** | Commit only `docs/test-inventory.md`, not test files themselves. |
| L-3 | Sanitization on non-string getters | LOW | **ACCEPT** | Focus on `sessionDir` + `executable` only. Skip `defaultProvider`/`defaultModel`. |

---

## Effort Estimates

| Task | Description | Person-Days | Parallelizable |
|------|-------------|-------------|----------------|
| 0.1 | RPC gap audit + delivery-checklist update | 1 | Yes |
| 0.2 | Test inventory + coverage baseline (c8) | 1 | Yes |
| 0.3 | Prettier config (no mass-format) | 0.5 | Yes |
| 1.1 | App.tsx useReducer (3 commits) | 4 | No |
| 1.2 | ChatProvider decomposition | 3 | No |
| 1.3 | Integration tests (tool events, chunks, env-echo) | 3 | No |
| 1.4 | Fix imports + extracted module tests | 2 | No |
| 2.1 | SessionManager + DiffController + Config + PiSession tests | 4 | No |
| 2.2 | ChatProvider dispatch tests (17 scenarios) | 3 | No |
| 3.1 | Command classifier + PermissionMode alignment + migration | 5 | No |
| 3.2 | Command preview full round-trip + audit log w/ rotation | 6 | No (blocks on 1.2, 3.1) |
| 3.3 | Config sanitization (sessionDir + executable only) | 1 | No (blocks on 1.2; no dep on 3.1) |
| 3.4 | Environment inheritance + PiSession wiring + env test | 3 | No (blocks on 1.2; no dep on 3.1) |
| 3.5 | Multi-position display (stretch) | 5 | No |
| 3.6 | Phase 3 integration test | 2 | No (blocks on 3.2+3.3) |
| 4.1 | FileSystemWatcher for file suggestions | 3 | No |
| 4.2 | Virtual scrolling static analysis | 1 | Yes |
| 4.3 | Shell detection for KI-006 | 1.5 | Yes |
| 5.1 | Pre-commit hook + CI | 1 | Yes |
| 5.2 | delivery-checklist + known-issues final | 1 | No |
| 5.3 | TECH_DESIGN.md update | 1 | No |
| 5.4 | Codebase mass-format | 0.5 | Yes |
| **Total** | | **~52** (+5 stretch) | |

---

## PRD Deliverability

| ID | User Story | Deliverable? | Phase/Task |
|----|-----------|-------------|------------|
| US-01-12, 17-18 | Chat, read files, diff, terminal, sessions, model switching, fork, slash commands | Already delivered | -- |
| **US-13** | Configure permission modes | **Enhanced:** off->readonly migration, plan mode in Configuration, permission-limiting in dispatch | Phase 3 Task 3.1 |
| US-16 | @-mention references | Already delivered (+ sanitization) | Phase 3 Task 3.3 |
| US-03, US-15 | Codebase search, git workflows | Partial (status OK, writes blocked on pi CLI) | -- |
| US-04, US-11, US-14, US-19 | Plan mode, rollback, skills, MCP isolation | **BLOCKED** (pi CLI RPC needed) | -- |

**Summary:** 12/19 delivered, 4 permanently blocked on pi CLI, 2 partial, 1 enhanced.

---

## Risks and Mitigations

| # | Risk | Like. | Impact | Mitigation |
|---|------|-------|--------|-----------|
| R1 | ChatProvider decomposition breaks session subscription | Med | High | Stepwise with tests; keep syncSubscriptions/dispatch as glue |
| R2 | useReducer introduces subtle state bugs | Med | High | 10+ unit tests before touching App.tsx; old reduceMessages as reference |
| R3 | Mock tests don't match real pi CLI | Med | High | Add `npm run smoke:rpc` (manual, skipped in CI) |
| R4 | Phase 3 dispatch changes conflict with decomposed ChatProvider | Med | High | Explicit deps: Phase 3 blocks on 1.2; 3.2 blocks on 3.1 |
| R5 | Command preview async pattern deadlock | Low | Med | 30s timeout on confirmation promise; cleanup on dispose() |

---

## Dependency Graph

```
Phase 0: Context Assessment (parallel, no deps)
  0.1 -- RPC gap + delivery-checklist update
  0.2 -- Test inventory + coverage baseline (c8)
  0.3 -- Prettier config (no mass-format)

Phase 1: Architecture + Testing (depends on Phase 0)
  1.1 -- App.tsx useReducer refactoring (3 commits)
  │         BREAKS: test/unit/reduceMessages.test.ts imports -- fix in 1.4
  1.2 -- ChatProvider decomposition (no dep on 1.1 -- different process domain)
  1.3 -- Extend integration tests (tool events, chunks, U+2028, concurrency,
  |       out-of-order, env-echo)
  └─ 1.4 -- Fix broken imports from 1.1 + extracted module tests

Phase 2: Fill Untested Modules (BLOCKED on 1.2)
  2.1 -- SessionManager + DiffController + Configuration + PiSession tests
  2.2 -- ChatProvider dispatch tests (14 success + 3 error-path scenarios)

Phase 3: Missing Features (BLOCKED on Task 1.2 -- ChatProvider must be decomposed first)
  │
  3.1 -- Command classifier + PermissionMode alignment + migration
  │       BLOCKED on: Task 1.2
  │       BLOCKS: 3.2 (needs classifier + PermissionMode type)
  │       NOTE: 3.3 and 3.4 have NO code dependency on 3.1 -- different files
  │
  ├── 3.2 -- Command preview round-trip + audit log w/ rotation
  │         BLOCKED on: Task 1.2, Task 3.1
  │
  ├── 3.3 -- Config sanitization (sessionDir + executable only)
  │         BLOCKED on: Task 1.2
  │         (CAN start in parallel with 3.1 -- different files, no type overlap)
  │
  ├── 3.4 -- Environment inheritance + PiSession wiring + env test
  │         BLOCKED on: Task 1.2
  │         (CAN start in parallel with 3.1 -- different files)
  │
  ├── 3.5 -- Multi-position display (stretch)
  │
  └── 3.6 -- Phase 3 integration test (classification->preview->audit->execution)
            BLOCKED on: 3.2, 3.3

Phase 4: Performance (depends on 1.3)
  4.1 -- FileSystemWatcher for file suggestions
  4.2 -- Virtual scrolling static analysis + known-issues
  4.3 -- Shell detection + KI-006 graceful degradation

Phase 5: Engineering Excellence (depends on 0.3 + Phase 2)
  5.1 -- Pre-commit hook + CI integration
  5.2 -- Update delivery-checklist.md + known-issues.md
  5.3 -- Update TECH_DESIGN.md for all architecture changes
  5.4 -- Codebase mass-format with Prettier (deferred from Phase 0.3)
```

---

## Phase 0: Context Assessment

### Task 0.1: RPC Gap Inventory & Delivery-Checklist Update

**Files:** Read-only audit + modify `docs/delivery-checklist.md`

- [ ] **Step 1: Read delivery-checklist.md and ROADMAP.md**

```bash
cat docs/delivery-checklist.md; cat ROADMAP.md
```

- [ ] **Step 2: Classify every delivery item as Blocked/Feasible/Stretch**

**Blocked (pi CLI RPC):** F-301~F-307, F-405, F-705~F-711, provider adapter section 4, MCP section 5.1, sub-agent section 5.4, git write section 3.10, streaming T-001~T-012, stream failover section 4.4, E2E scenarios #8/9/10/18/19, S-009.

**Extension-feasible:** F-502 (3.2), F-511 (3.4), F-512 (3.1), F-513 (3.2), F-004 (3.5 stretch), S-002 (3.3).

- [ ] **Step 3: Write labels into delivery-checklist.md**

Update each row: `[Blocked: pi CLI RPC]` or `[Planned: Phase 3.X]`.

- [ ] **Step 4: Commit**

```bash
git add docs/delivery-checklist.md && git commit -m "docs: RPC gap inventory with blocked/feasible labels"
```

---

### Task 0.2: Test Inventory & Coverage Baseline (M-3 fix)

**Files:** Read-only audit + modify `package.json` for c8
- Create: `docs/test-inventory.md`
- Modify: `package.json` -- add c8 devDependency + test:coverage script

- [ ] **Step 1: Read all existing tests**

```bash
wc -l test/integration/*.ts test/unit/*.ts
```

Existing: 29 integration tests (lifecycle, commands, protocol, timeout, events). 75 unit tests across 10 files (reduceMessages, PiRpcClient, lineReader, requestQueue, security, decodeFromWebview, parseUnifiedDiff, HeaderBar, PlanReviewCard, SelectionIndicator).

Untested modules (1717 LOC): ChatProvider (419), SessionManager (163), PiSession (134), DiffController (334), Configuration (127), AuthService, PiTerminal, SessionTreeProvider, WebviewMessenger.

- [ ] **Step 2: Install c8 and add test:coverage script**

```bash
npm install --save-dev c8
```

In `package.json` scripts: `"test:coverage": "c8 npm run test:unit && c8 npm run test:integration"`

Add `.c8rc.json`:
```json
{ "c8": { "reporter": ["text", "lcov"], "all": true, "include": ["src/**/*.ts", "src/**/*.tsx"], "exclude": ["src/rpc/types.ts"] } }
```

- [ ] **Step 3: Write structured inventory to docs/test-inventory.md (L-2 fix)**

Write a structured inventory listing all test files with line counts, coverage gaps, and a note about the target (80% coverage on newly tested modules).

- [ ] **Step 4: Run initial coverage baseline**

```bash
npm run test:coverage
```

- [ ] **Step 5: Commit (L-2 fix: only docs/test-inventory.md, not test files)**

```bash
git add docs/test-inventory.md package.json .c8rc.json 2>/dev/null || git add docs/test-inventory.md package.json && git commit -m "audit: test inventory and coverage baseline with c8"
```

---

### Task 0.3: Prettier Config (No Mass-Format) (H-4 fix)

**Files:**
- Create: `.prettierrc`, `.prettierignore`
- Modify: `package.json` -- add format, format:check scripts

**NOTE (H-4):** Mass-format is NOT applied here. Deferred to Task 5.4. Config uses `singleQuote: true` matching existing codebase style (produces zero diffs). `.prettierignore` prevents formatting generated files.

- [ ] **Step 1: Create .prettierrc**

```json
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "tabWidth": 2 }
```

- [ ] **Step 2: Create .prettierignore**

```
**/node_modules/**  **/webview/out/**  **/.git/**  **/dist/**  **/coverage/**  package.json  package-lock.json
```

- [ ] **Step 3: Add scripts to package.json**

```json
"format": "prettier --write \"src/**/*.{ts,tsx}\" \"test/**/*.ts\"",
"format:check": "prettier --check \"src/**/*.{ts,tsx}\" \"test/**/*.ts\""
```

- [ ] **Step 4: Verify format:check passes**

```bash
npm run format:check && npm run test:unit && npm run test:integration
```

- [ ] **Step 5: Commit config only (no mass-format)**

```bash
git add .prettierrc .prettierignore package.json && git commit -m "chore: add Prettier config (mass-format deferred to Task 5.4)"
```

---

## Phase 1: Architecture + Testing

### Task 1.1: App.tsx useReducer (3 Commits) (H-3 fix)

**Files:**
- Create: `src/ui/AppState.ts` -- AppState interface, AppAction union, appReducer
- Create: `src/ui/WelcomeScreen.tsx`
- Create: `src/ui/InputArea.tsx`
- Modify: `src/ui/App.tsx` -- strip to layout + dispatch
- Create: `test/unit/appReducer.test.ts`
- Modify: `test/unit/reduceMessages.test.ts` -- fix imports

**CRITICAL:** Import path for `reduceMessages`, `convertAgentMessages`, `textFromMsg`, `textFromResult`, `DisplayMessage` changes from `App` to `AppState`. Fix in 1.4.

**H-3 fix: 3 separate commits for bisectability.**

#### Commit A: AppState.ts + appReducer tests

- [ ] **Step 1: Create `src/ui/AppState.ts`**

Extract from `App.tsx`: `DisplayMessage`, `reduceMessages()`, `convertAgentMessages()`, `textFromMsg()`, `textFromResult()`, `formatSelectionBadge()`.

Add typed action system:
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
  messages: DisplayMessage[]; isStreaming: boolean; model: string; thinking: string;
  suggestions: string[]; contextItems: string[]; gitBranch: string; gitChanges: string;
  changeSummary: string; sessionName: string; sessions: SessionItem[];
}
```

`appReducer(state, action)` -- pure function, no React deps.

- [ ] **Step 2: Add appReducer unit tests (L-1 fix)**

Test 10 scenarios:
1. Initial state is correct
2. `piEvent` delegates to reduceMessages
3. `stateSnapshot` updates model, thinking, isStreaming
4. `stateSnapshot` with new sessionId resets messages
5. `history` sets messages via convertAgentMessages
6. `selectSession` changes sessionId and clears messages
7. `fileSuggestions` updates suggestions array
8. `gitStatus` updates branch and changes string
9. **Action with kind "nonexistent" cast via `as any` -- returns state unchanged. Comment: "The `as any` cast simulates a runtime path TypeScript normally prevents; ensures the default branch handles unexpected kind values gracefully."** (L-1 fix)
10. Multiple actions compose correctly

- [ ] **Step 3: Commit A**

```bash
git add src/ui/AppState.ts test/unit/appReducer.test.ts && git commit -m "refactor: extract AppState.ts with appReducer and typed actions"
```

#### Commit B: WelcomeScreen.tsx + InputArea.tsx

- [ ] **Step 4: Extract components** -- move existing inline ~50-line WelcomeScreen and ~200-line InputArea with their prop types.

- [ ] **Step 5: Commit B**

```bash
git add src/ui/WelcomeScreen.tsx src/ui/InputArea.tsx && git commit -m "refactor: extract WelcomeScreen.tsx and InputArea.tsx"
```

#### Commit C: App.tsx rewrite + import fixes

- [ ] **Step 6: Rewrite App.tsx**

Replace 13 `useState` calls with `const [state, dispatch] = useReducer(appReducer, initialState)`. `onHostMessage` becomes `dispatch(action)`. Target: ~120 layout + dispatch lines.

- [ ] **Step 7: Fix reduceMessages.test.ts imports**

Change `../../src/ui/App` to `../../src/ui/AppState` for all imported symbols.

- [ ] **Step 8: Run all tests**

```bash
npm run compile && npm run test:unit && npm run build
```

- [ ] **Step 9: Commit C**

```bash
git add src/ui/App.tsx test/unit/ && git commit -m "refactor: App.tsx useReducer, fix test imports"
```

---

### Task 1.2: ChatProvider Decomposition

**Files:**
- Create: `src/view/ContextBuilder.ts`
- Create: `src/view/GitStatusReader.ts`
- Create: `src/view/ChangeTracker.ts`
- Modify: `src/view/ChatProvider.ts` -- slim to ~200 lines

**Problem:** ChatProvider (419 lines) manages 6 responsibilities in one class: WebviewView lifecycle, session subscriptions, state pushing (pushState, pushFileSuggestions, pushContext, pushGitStatus, pushChangeSummary), event forwarding/tool tracking, webview dispatch, auto-session creation.

- [ ] **Step 1: Create ContextBuilder.ts**

Move `pushContext()` logic -> `buildContextItems(): Promise<ContextItem[]>`, `pushFileSuggestions()` logic -> `getFileSuggestions(): Promise<FileSuggestion[]>`.

```typescript
export interface ContextItem { type: "file" | "selection" | "diagnostic"; label: string; detail?: string; removable: boolean; id: string; }
export async function buildContextItems(): Promise<ContextItem[]> { /* ... */ }
export interface FileSuggestion { path: string; isFile: boolean; }
export async function getFileSuggestions(config: { respectGitIgnore: boolean }): Promise<FileSuggestion[]> { /* ... */ }
```

- [ ] **Step 2: Create GitStatusReader.ts**

Move `pushGitStatus()` logic -> `readGitStatus(): Promise<GitStatus | null>`.

```typescript
export interface GitStatus { branch: string; added: number; deleted: number; modified: number; ahead: number; behind: number; }
export async function readGitStatus(): Promise<GitStatus | null> { /* ... */ }
```

- [ ] **Step 3: Create ChangeTracker.ts**

Move `pendingChanges` + `trackChange()` + `pushChangeSummary()` logic.

```typescript
export interface FileChange { file: string; action: "create" | "modify"; added: number; removed: number; }
export class ChangeTracker {
  private changes: FileChange[] = [];
  recordEvent(e: T.ToolExecutionEndEvent): void { /* ... */ }
  summarize(): string { /* ... */ }
}
```

- [ ] **Step 4: Slim ChatProvider.ts to ~200 lines**

Retains: constructor, resolveWebviewView, reveal, dispatch, pushState, forward, syncSubscriptions, buildHtml, dispose.

- [ ] **Step 5: Add import paths (M-2 fix)**

```typescript
import { buildContextItems, getFileSuggestions, type ContextItem, type FileSuggestion } from "./ContextBuilder";
import { readGitStatus, type GitStatus } from "./GitStatusReader";
import { ChangeTracker, type FileChange } from "./ChangeTracker";
```

Uses: `pushState()` -> `buildContextItems()`, `readGitStatus()`, `ChangeTracker`; `pushFileSuggestions()` -> `getFileSuggestions()`; `forward()` -> `ChangeTracker.recordEvent()`.

- [ ] **Step 6: Run tests and build**

```bash
npm run compile && npm run test:unit && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/view/ && git commit -m "refactor: decompose ChatProvider into ContextBuilder, GitStatusReader, ChangeTracker"
```

---

### Task 1.3: Extend Integration Tests (H-1, M-7)

**Files:**
- Modify: `test/integration/mockRpcServer.ts` -- add scenarios
- Create: `test/integration/rpc-event-stream.test.ts`
- Modify: `test/integration/rpc-protocol.test.ts`
- Modify: `test/integration/rpc-commands.test.ts`

- [ ] **Step 1: Enhance mockRpcServer.ts with tool events (H-1)**

Import `crypto` for unique toolCallId generation. Add two new scenario functions:

`makeToolEventSequence()`: generates 8 events -- agent_start, message_start, tool_execution_start (edit, callId1), tool_execution_start (bash, callId2), message_update with tool_use_delta, tool_execution_end (edit, callId1, with diff result), tool_execution_end (bash, callId2, with exit_code), agent_end.

`makeOutOfOrderEventSequence()`: generates 5 events -- agent_start, message_start, **tool_execution_end** (arrives first, no matching start yet), **tool_execution_start** (arrives later), agent_end. Verifies the end is silently dropped and the start creates a stuck "running" indicator.

Add `env-echo` scenario (M-7): responds to any command with a JSON object containing selected environment variables from the child process (PATH truncated, HOME, MY_CUSTOM_VAR, CUSTOM_LIST), plus an `inherited` boolean flag. This allows verification that env inheritance settings take effect.

Add mock scenarios: `dual-tools`, `chunks` (split JSON across 3 writes), `banner` (2 non-JSON lines before valid response), `multi-session` (accept `__session__` control command).

- [ ] **Step 2: Write rpc-event-stream.test.ts**

8 test cases:
1. Normal stream: agent_start -> message_start -> text_delta -> message_end -> agent_end
2. Dual tool interleaved: tool1_start -> tool2_start -> tool1_end -> tool2_end (no cross-talk)
3. Duplicate agent_end -> idempotent
4. Compaction events interleaved with tool events
5. Empty stream
6. Partial JSON chunk reassembled across 3 writes (must match `id`)
7. U+2028/U+2029 inside JSON strings (integration level)
8. Out-of-order delivery: tool_execution_end for callId arrives before tool_execution_start -> end silently dropped, start creates stuck indicator -> document as known limitation

- [ ] **Step 3: Add concurrent session isolation test** -- two PiRpcClient instances, separate mock servers, must not cross events
- [ ] **Step 4: Add multi-write partial JSON test to rpc-protocol.test.ts**
- [ ] **Step 5: Run and commit**

```bash
npm run test:integration
git add test/integration/ && git commit -m "test: extend integration tests with tool events, chunks, U+2028, concurrency, out-of-order, env-echo"
```

---

### Task 1.4: Fix Imports + Extracted Module Tests

**Files:**
- Verify: `test/unit/reduceMessages.test.ts` -- imports updated in 1.1
- Create: `test/unit/ContextBuilder.test.ts` (4 tests)
- Create: `test/unit/ChangeTracker.test.ts` (5 tests)

- [ ] **Step 1: Verify reduceMessages.test.ts imports**

```bash
npm run test:unit  # 75+ tests passing
```

- [ ] **Step 2: Write ContextBuilder tests**

Test: findFiles with exclude pattern, empty workspace returns [], open editor tabs included, duplicates filtered.

- [ ] **Step 3: Write ChangeTracker tests**

Test: edit tool records change, bash tool no change, summarize returns string + clears list, multiple changes combine, empty list returns "".

- [ ] **Step 4: Run full suite and commit**

```bash
npm run compile && npm run test:unit && npm run test:integration && npm run build && git add test/unit/ && git commit -m "test: add ContextBuilder and ChangeTracker unit tests"
```

---

## Phase 2: Fill Untested Modules

### Task 2.1: SessionManager + DiffController + Configuration + PiSession Unit Tests

**Files:** Create 4 test files.

- [ ] **Step 1: SessionManager.test.ts** -- 8 tests with mock PiSession factory: create, maxConcurrent (3) throws, close disposes, setActive fires onDidChange, forkActive, restoreSaved, reopenLastClosed, getSessionRoot
- [ ] **Step 2: DiffController.test.ts** -- 6 tests: snapshot on tool_execution_start, diff on tool_execution_end, acceptCurrent no-op, revertCurrent restores, conflict detection warns, acceptCurrent with no pending diff is no-op
- [ ] **Step 3: Configuration.test.ts** -- 6 tests with mock WorkspaceConfiguration: permissionMode read (after migration), extraArgs includes provider/model/session-dir, cwd with workspaceRoot override, cwd fallback to workspace root, maxConcurrentSessions clamped to min 1, onDidChange fires on pi.* change
- [ ] **Step 4: PiSession.test.ts** -- 4 tests: construction sets PiRpcClient with correct args, prompt delegates, abort delegates, dispose cleans up
- [ ] **Step 5: Run and commit**

```bash
npm run compile && npm run test:unit && npm run test:integration && git add test/unit/ && git commit -m "test: add SessionManager, DiffController, Configuration, PiSession tests"
```

---

### Task 2.2: ChatProvider Dispatch Tests (Success + Error Paths)

**Files:** Create `test/unit/ChatProvider.test.ts`.

- [ ] **Step 1: 14 success-path tests**

Cover every dispatch branch: prompt, steer, abort, setModel, cycleModel, setThinkingLevel, login, logout, acceptDiff, rejectDiff, requestFileSuggestions, removeContextItem, unknown kind (no-op), no active session (silent drop).

- [ ] **Step 2: 3 error-path tests (F2.4)**

1. `s.prompt()` rejects -> showErrorMessage called, not re-thrown
2. `diff.acceptCurrent()` throws -> caught, showErrorMessage called
3. `autosaveFiles` fails -> prompt still called after failure, error doesn't swallow

```typescript
it("handles s.prompt() rejection gracefully", async () => {
  const mockSession = createMockSession({ prompt: async () => { throw new Error("RPC timeout"); }});
  const mockShowError = sinon.stub(vscode.window, "showErrorMessage");
  const cp = new ChatProvider(ctx, mockSessionManager, mockDiff);
  await cp["dispatch"]({ kind: "prompt", text: "hello", images: [] });
  assert(mockShowError.calledOnceWith(sinon.match("RPC timeout")));
});
```

- [ ] **Step 3: pushFileSuggestions with mock workspace test**
- [ ] **Step 4: Run and commit**

```bash
npm run compile && npm run test:unit && git add test/unit/ChatProvider.test.ts && git commit -m "test: ChatProvider dispatch tests (17 scenarios)"
```

---

## Phase 3: Missing Delivery Features

**CRITICAL:** ALL Phase 3 tasks BLOCK on Task 1.2. Phase 3.2 blocks on 3.1. Phase 3.3 and 3.4 have NO dependency on 3.1.

---

### Task 3.1: Command Classifier + PermissionMode Alignment (CR-2) + Migration

**Files:**
- Create: `src/types/permission.ts` -- single source of truth
- Create: `src/security/commandClassifier.ts`
- Modify: `src/settings/Configuration.ts` -- 5-option type + migration
- Modify: `src/ui/ModesMenu.tsx` -- replace `edit` with `readonly`
- Modify: `package.json` -- update enum atomically
- Modify: `src/view/ChatProvider.ts` -- wire classification into dispatch

**CR-2: PermissionMode is currently different in 3 places:**
- ModesMenu.tsx: `"manual" | "edit" | "plan" | "auto" | "bypass"` (has `edit`, no `readonly`)
- Configuration.ts return type: `"off" | "manual" | "auto"`
- package.json schema enum: `["off", "manual", "auto"]`

**Target:** `"readonly" | "plan" | "manual" | "auto" | "bypass"` -- the 4 spec modes + hidden bypass.

- [ ] **Step 1: Create `src/types/permission.ts`** (single source of truth)

```typescript
/**
 * Permission mode -- single source of truth.
 * "readonly": Block all writes. "plan": Read-only exploration. "manual": Confirm each.
 * "auto": Auto-allow safe/sensitive, prompt for dangerous (default). "bypass": Hidden, skip all.
 */
export type PermissionMode = "readonly" | "plan" | "manual" | "auto" | "bypass";
```

- [ ] **Step 2: Update ModesMenu.tsx**

Remove local `PermissionMode` type definition. Import from `../types/permission`. Replace "edit" MODES entry with:
```typescript
{ id: "readonly", icon: "<shield>", title: "Read-only", desc: "Claude can read but will not make any edits" }
```
Update SVG icon rendering to include `mode.id === "readonly"` handler.

- [ ] **Step 3: Update Configuration.ts** -- migration from old `"off"` to `"readonly"`

```typescript
import { type PermissionMode } from "../types/permission";
private _migrated = false;

get permissionMode(): PermissionMode {
  const raw = this.cfg().get<string>("permissionMode");
  if (raw === "off") {
    if (!this._migrated) {
      this._migrated = true;
      this.cfg().update("permissionMode", "readonly", vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage("Pi Code: Permission mode 'off' renamed to 'readonly'. Migrated automatically.");
    }
    return "readonly";
  }
  if (raw === "readonly" || raw === "plan" || raw === "manual" || raw === "auto" || raw === "bypass") return raw;
  return "auto"; // default
}
```

- [ ] **Step 4: Update package.json schema**

```json
"pi.permissionMode": { "type": "string", "default": "auto", "enum": ["readonly", "plan", "manual", "auto"],
  "description": "Permission mode: 'readonly' (block all writes), 'plan' (read-only), 'manual' (confirm each), 'auto' (auto-allow with safety). 'bypass' is hidden." }
```

Note: `"bypass"` is intentionally NOT in the schema.

- [ ] **Step 5: Read existing validation.ts for reuse** -- `isSensitiveFile()` and `resolveSafePath()` exist and must be reused

- [ ] **Step 6: Implement commandClassifier.ts (full pattern set)**

```typescript
export type CommandRisk = "safe" | "sensitive" | "dangerous";
export interface Classification { risk: CommandRisk; reason?: string; }

// Dangerous patterns: always warn regardless of mode (except bypass)
const DANGEROUS_PATTERNS = [
  { regex: /rm\s+(-[rf]+\s+)?\/$|rm\s+-rf\s+\/\s*$/i, reason: "Recursive root delete" },
  { regex: /^sudo\s+/, reason: "Sudo command" },
  { regex: /chmod\s+777/i, reason: "World-writable permissions" },
  { regex: /^dd\s+/, reason: "Raw disk write" },
  { regex: /^mkfs/, reason: "Filesystem creation" },
  { regex: /git\s+push\s+--force/, reason: "Force push" },
  { regex: /(\|)\s*(curl|wget)\s+.*(\||\s*sh\s*)/i, reason: "Pipe fetch to shell" },
];

// Sensitive patterns: warn only in manual mode
const SENSITIVE_PATTERNS = [
  { regex: /^rm\s+/, reason: "File deletion" },
  { regex: /^mv\s+/, reason: "File move" },
  { regex: /^chmod|^chown/, reason: "Permission change" },
  { regex: /docker\s+rm\s+|docker\s+stop\s+/, reason: "Container management" },
  { regex: /git\s+reset\s+|git\s+rebase\s+/, reason: "Git history rewrite" },
  { regex: /npm\s+publish|pip\s+install/, reason: "Package management" },
];

export function classifyCommand(cmd: string): Classification {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.regex.test(cmd.trim())) return { risk: "dangerous", reason: p.reason };
  }
  for (const p of SENSITIVE_PATTERNS) {
    if (p.regex.test(cmd.trim())) return { risk: "sensitive", reason: p.reason };
  }
  return { risk: "safe" };
}
```

**NOTE:** Token-based pattern matching. Trivially bypassed by compound commands, base64, scripts. **This is a best-effort UX guardrail, not a security boundary.**

- [ ] **Step 7: Wire into dispatch**

In ChatProvider.dispatch(), before executing prompt/steer:

```typescript
const classification = classifyCommand(msg.text);
const mode = this.ctx.config.permissionMode;

if (mode === "readonly") {
  vscode.window.showErrorMessage("Cannot execute in readonly mode."); return;
}
if (classification.risk === "dangerous" && mode !== "bypass") {
  const confirm = await vscode.window.showWarningMessage(
    `Dangerous command: ${classification.reason}`, { modal: true }, "Execute");
  if (!confirm) return;
}
if (classification.risk === "sensitive" && mode === "manual") {
  // Use webview preview (Task 3.2) or fall back to VS Code dialog
}
```

- [ ] **Step 8: Add unit tests** -- 8 classifier + 3 migration tests
- [ ] **Step 9: Run and commit**

```bash
npm run compile && npm run test:unit && npm run build && git add src/types/permission.ts src/security/ src/settings/ src/ui/ModesMenu.tsx package.json && git commit -m "feat: command classifier (F-512) with PermissionMode alignment and migration"
```

---

### Task 3.2: Command Preview Full Round-Trip (CR-1) + Audit Log w/ Rotation (M-1)

**Files:**
- Create: `src/security/auditLog.ts` -- JSONL with rotation
- Modify: `src/view/WebviewMessenger.ts` -- 3 new message types
- Modify: `src/view/ChatProvider.ts` -- async promise pattern
- Modify: `webview/src/ConfirmCard.tsx` -- confirmation UI

**CR-1 requires 5 coordinated changes:**

#### Part A: Audit Log with Rotation (M-1)

- [ ] **Step 1: Implement auditLog.ts**

```typescript
export interface AuditEntry {
  timestamp: string;
  kind: "command" | "file_write" | "file_delete" | "permission_elevation" | "config_change";
  detail: string; risk?: string; authorized: boolean;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private logPath: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;
  private readonly MAX_ARCHIVES = 3;

  constructor(storagePath: string) {
    this.logPath = path.join(storagePath, "audit.jsonl");
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    this.flushTimer = setInterval(() => this.checkRotation(), 30_000).unref();
  }

  private checkRotation(): void {
    try {
      if (fs.statSync(this.logPath).size >= this.MAX_FILE_SIZE) this.rotate();
    } catch { /* file doesn't exist yet */ }
  }

  private rotate(): void {
    const dir = path.dirname(this.logPath);
    const oldest = path.join(dir, `audit.${this.MAX_ARCHIVES}.jsonl`);
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = this.MAX_ARCHIVES - 1; i >= 1; i--) {
      const src = path.join(dir, `audit.${i}.jsonl`);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, `audit.${i + 1}.jsonl`));
    }
    fs.renameSync(this.logPath, path.join(dir, "audit.1.jsonl"));
  }

  record(entry: Omit<AuditEntry, "timestamp">): void {
    const fullEntry: AuditEntry = { timestamp: new Date().toISOString(), ...entry };
    this.entries.push(fullEntry);
    if (this.entries.length > 1000) this.entries.shift();
    try { this.checkRotation(); fs.appendFileSync(this.logPath, JSON.stringify(fullEntry) + "\n"); } catch {}
  }

  dump(): AuditEntry[] { return [...this.entries]; }
  readAll(): AuditEntry[] {
    try { return fs.readFileSync(this.logPath, "utf-8").trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch { return [...this.entries]; }
  }
  dispose(): void { if (this.flushTimer) clearInterval(this.flushTimer); }
}
```

#### Part B: WebviewMessenger Message Types (CR-1a/b/c)

- [ ] **Step 2: Add `commandPreview` to HostToWebview (CR-1a)**

```typescript
export interface CommandPreviewMessage {
  kind: "commandPreview";
  command: string;
  risk: "safe" | "sensitive" | "dangerous";
  reason?: string;
  previewId: string;  // unique ID for matching confirm/cancel
}
// Append to HostToWebview union type
```

- [ ] **Step 3: Add `confirmCommand`/`cancelCommand` to WebviewToHost (CR-1b)**

```typescript
export interface ConfirmCommandMessage { kind: "confirmCommand"; previewId: string; }
export interface CancelCommandMessage { kind: "cancelCommand"; previewId: string; }
// Append both to WebviewToHost union type
```

- [ ] **Step 4: Update `decodeFromWebview` validKinds set (CR-1c)**

```typescript
const validKinds = new Set([
  "prompt", "steer", "abort", "setModel", "cycleModel", "setThinkingLevel",
  "login", "logout", "acceptDiff", "rejectDiff", "requestFileSuggestions",
  "removeContextItem", "confirmCommand", "cancelCommand",  // NEW
]);
```

#### Part C: Async Dispatch Pattern (CR-1d)

- [ ] **Step 5: Implement async wait pattern in ChatProvider**

```typescript
private pendingConfirmation: { previewId: string; resolve: (v: boolean) => void; timer: NodeJS.Timeout } | null = null;
private readonly CONFIRM_TIMEOUT_MS = 30_000;

private askForConfirmation(previewId: string, command: string, classification: Classification): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { this.pendingConfirmation = null; resolve(false); }, this.CONFIRM_TIMEOUT_MS);
    this.pendingConfirmation = { previewId, resolve, timer };
    if (this.webviewView) {
      postToWebview(this.webviewView.webview, {
        kind: "commandPreview", command, risk: classification.risk, reason: classification.reason, previewId,
      });
    } else { clearTimeout(timer); this.pendingConfirmation = null; resolve(false); }
  });
}
```

In `onDidReceiveMessage` handler:
```typescript
case "confirmCommand":
  if (this.pendingConfirmation?.previewId === msg.previewId) {
    clearTimeout(this.pendingConfirmation.timer);
    this.pendingConfirmation.resolve(true);
    this.pendingConfirmation = null;
  }
  break;
case "cancelCommand":
  if (this.pendingConfirmation?.previewId === msg.previewId) {
    clearTimeout(this.pendingConfirmation.timer);
    this.pendingConfirmation.resolve(false);
    this.pendingConfirmation = null;
  }
  break;
```

In `dispose()`: reject any pending promise to prevent leaks (R5 mitigation).

#### Part D: Confirmation UI Card (CR-1e)

- [ ] **Step 6: Add ConfirmCard.tsx in webview React code**

```tsx
function ConfirmCard({ command, risk, reason, previewId, onConfirm, onCancel }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="confirm-card">
      <div className="confirm-risk-badge">{risk === "dangerous" ? "DANGEROUS" : "SENSITIVE"}</div>
      <div className="confirm-command">{command}</div>
      {reason && <div className="confirm-reason">{reason}</div>}
      <div className="confirm-buttons">
        <button className="btn-cancel" onClick={() => { onCancel(previewId); setDismissed(true); }}>Cancel</button>
        <button className="btn-execute" onClick={() => { onConfirm(previewId); setDismissed(true); }}>Execute</button>
      </div>
    </div>
  );
}
```

The component listens for `commandPreview` messages and auto-dismisses after timeout (handled by host).

- [ ] **Step 7: Wire audit into dispatch** -- record entry before prompt/steer
- [ ] **Step 8: Unit tests -- 6 audit + 4 confirmation flow tests**

Audit log tests:
1. `record()` add entry -> `dump()` returns it
2. 1001 entries -> oldest evicted from memory (array length ≤ 1000)
3. `record()` writes to disk -> `readAll()` reads it back
4. File grows past 10MB -> `checkRotation()` renames to `.1`, rotates archives
5. Wire audit into dispatch: prompt/steer actions produce audit entries with correct kind/risk/authorized
6. `dispose()` clears interval timer (no memory leak)

Confirmation flow tests:
1. `askForConfirmation()` posts `commandPreview` message to webview with correct previewId
2. Incoming `confirmCommand` with matching previewId resolves promise with `true`
3. Incoming `cancelCommand` with matching previewId resolves promise with `false`
4. 30s timeout on `askForConfirmation()` auto-rejects with `false`, cleans up pending state
- [ ] **Step 9: Commit**

```bash
git add src/security/auditLog.ts src/view/WebviewMessenger.ts src/view/ChatProvider.ts webview/ && git commit -m "feat: command preview round-trip (F-502) and persisted audit log with rotation (F-513)"
```

---

### Task 3.3: Config Sanitization (L-3 fix)

**Files:**
- Modify: `src/settings/Configuration.ts` -- sanitize `sessionDir` + `executable` only
- Modify: `src/ui/InputArea.tsx` -- @-mention sanitize display

**L-3 fix:** `defaultProvider` and `defaultModel` are schema-controlled enum-like values. Skip them. Only `executable` (freeform path) and `sessionDir` (freeform path with potential PII) need sanitization.

- [ ] **Step 1: Sanitize executable + sessionDir getters**

```typescript
import { sanitizeLogMessage } from "../security/validation";

get executable(): string {
  return sanitizeLogMessage(this.cfg().get<string>("path") || "pi");
}

get sessionDir(): string | undefined {
  const v = this.cfg().get<string>("sessionDir") || "";
  if (!v) return undefined;
  if (v.includes("${workspaceFolder}")) {
    return sanitizeLogMessage(v.replace(/\$\{workspaceFolder\}/g, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()));
  }
  return sanitizeLogMessage(v);
}
```

NOT sanitized: `defaultProvider` (schema-controlled), `defaultModel` (schema-controlled), `permissionMode` (enum), `maxConcurrentSessions` (number), etc.

- [ ] **Step 2: Sanitize @-mention display text (KI-001)**

```typescript
export function sanitizeDisplayText(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); // null bytes + control chars
}
```

Note: React JSX auto-escapes HTML. Strict CSP blocks inline scripts. This is defense-in-depth.

- [ ] **Step 3: Commit**

```bash
git commit -am "fix: sanitize config at entry point (S-002) and @-mention display (KI-001)"
```

---

### Task 3.4: Environment Inheritance (F-511) + PiSession Wiring (H-2) + Env Test (M-7)

**Files:**
- Modify: `src/settings/Configuration.ts` -- add getters
- Modify: `src/session/PiSession.ts` -- pass env to PiRpcClient (H-2)
- Modify: `src/rpc/PiRpcClient.ts` -- ensure inheritEnv option
- Create: `test/integration/rpc-env.test.ts` (M-7)

- [ ] **Step 1: Add inheritEnv + extraEnv getters to Configuration**

```typescript
get inheritEnv(): boolean { return this.cfg().get<boolean>("inheritEnv") ?? true; }
get extraEnv(): Record<string, string> { return this.cfg().get<Record<string, string>>("extraEnv") ?? {}; }
```

- [ ] **Step 2: Modify PiSession constructor (H-2)**

Currently PiSession creates PiRpcClient without passing env options:
```typescript
this.client = new PiRpcClient({
  executable: config.executable,
  extraArgs: [...config.extraArgs(), "--session-id", id],
  cwd: config.cwd(),
  autoReconnect: config.autoReconnect,
  // MISSING: inheritEnv, env
  log: (level, msg) => ctx.log(level, `[session ${id}] ${msg}`),
});
```

Fix -- pass env options:
```typescript
this.client = new PiRpcClient({
  executable: config.executable,
  extraArgs: [...config.extraArgs(), "--session-id", id],
  cwd: config.cwd(),
  autoReconnect: config.autoReconnect,
  inheritEnv: config.inheritEnv,       // NEW: controls whether to inherit process.env
  env: config.extraEnv,                 // NEW: extra env vars to merge or use exclusively
  log: (level, msg) => ctx.log(level, `[session ${id}] ${msg}`),
});
```

- [ ] **Step 3: Ensure PiRpcClientOptions has inheritEnv field and wiring**

Check `src/rpc/PiRpcClient.ts` for existing `inheritEnv` support. If absent, add:

```typescript
// In PiRpcClientOptions interface:
export interface PiRpcClientOptions {
  executable: string;
  extraArgs?: string[];
  skipModePrefix?: boolean;
  cwd?: string;
  requestTimeoutMs?: number;
  autoReconnect?: boolean;
  maxBackoffMs?: number;
  env?: Record<string, string>;       // Already exists
  inheritEnv?: boolean;                // NEW: controls process.env inheritance
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}
```

In the `start()` or `spawn()` method where the child process is created:

```typescript
// BEFORE (if currently always inheriting):
const child = spawn(executable, args, {
  cwd: this.opts.cwd,
  env: { ...process.env, ...this.opts.env },  // always inherits
  stdio: ["pipe", "pipe", "pipe"],
});

// AFTER (conditional inheritance):
const childEnv = this.opts.inheritEnv !== false
  ? { ...process.env, ...this.opts.env }  // inherit + merge
  : { ...this.opts.env };                  // only explicit env

const child = spawn(executable, args, {
  cwd: this.opts.cwd,
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
```

- [ ] **Step 4: Add env echo mock scenario (M-7)** -- in mockRpcServer.ts `env-echo` case
- [ ] **Step 5: Create rpc-env.test.ts** -- 3 tests (inheritEnv=true, false, extraEnv overrides)
- [ ] **Step 6: Run and commit**

```bash
npm run compile && npm run test:unit && npm run test:integration && git add src/settings/ src/session/ src/rpc/ test/ && git commit -m "feat: environment inheritance control (F-511) with PiSession wiring and integration test"
```

---

### Task 3.5: Multi-Position Display (F-004) -- Stretch

**Files:** Modify `src/view/ChatProvider.ts`, add `pi.chatPosition` setting.

- [ ] **Step 1: Add `pi.chatPosition` = `"sidebar" | "tab" | "secondary"`**
- [ ] **Step 2: When position !== "sidebar", create WebviewPanel** instead of WebviewView
- [ ] **Step 3: Commit `git commit -am "feat: multi-position chat display (F-004)"`**

---

### Task 3.6: Phase 3 Integration Test (H-5)

**Files:** Create `test/integration/pi-permission-flow.test.ts`.

**Goal:** End-to-end test: webview message -> decodeFromWebview -> classify -> preview -> confirm/block -> execute -> audit.

- [ ] **Step 1: Create test harness** -- mock WebviewView (captures postMessage), mock SessionManager + PiSession, mock Configuration (controllable permissionMode), mock AuditLog, real decodeFromWebview + classifyCommand

- [ ] **Step 2: Write 6 flow tests**

1. Safe command in auto mode -> dispatch continues -> audit entry recorded (authorized=true)
2. Dangerous command in auto mode -> commandPreview sent -> confirmCommand received -> dispatch continues -> audit authorized=true
3. Dangerous command, user cancels -> commandPreview sent -> cancelCommand -> dispatch stops -> audit authorized=false
4. Readonly mode -> any command blocked with error -> no session.execution -> no audit
5. Plan mode for write command -> block with "plan mode does not allow writes" -> no audit
6. Unknown kind -> decodeFromWebview returns null -> no dispatch -> no audit entry

- [ ] **Step 3: Run and commit**

```bash
npm run compile && npm run test:integration && git add test/integration/pi-permission-flow.test.ts && git commit -m "test: Phase 3 integration test for classification->preview->audit->execution"
```

---

## Phase 4: Performance

### Task 4.1: FileSystemWatcher for File Suggestions

**Files:** Modify `src/view/ChatProvider.ts` (or ContextBuilder.ts after Task 1.2).

**Problem:** `pushFileSuggestions()` calls `findFiles("**/*", excludePattern, 200)` on EVERY file open -- 200-500ms per call.

- [ ] **Step 1: Code-path analysis (F2.3 fix)** -- confirm findFiles is called on onDidOpenTextDocument, onDidChangeWorkspaceFolders, and onDidChangeVisibility. In a workspace with 10K+ files, 200-500ms per invocation. A developer navigating files triggers 10+ scans/minute. FileSystemWatcher justified.

- [ ] **Step 2: Implement FileSystemWatcher + 30s cache**

```typescript
// Replace:
vscode.workspace.onDidOpenTextDocument(() => void this.pushFileSuggestions())

// With:
const watcher = vscode.workspace.createFileSystemWatcher("**/*");
watcher.onDidCreate(() => void this.pushFileSuggestions());
watcher.onDidDelete(() => void this.pushFileSuggestions());
// onDidChange NOT watched -- opening a file fires change, not create/delete
this.disposables.push(watcher);
```

Add cache with 30s TTL: only re-run findFiles when cache expired or watcher fired. Use cached results otherwise.

- [ ] **Step 3: Commit**

```bash
git commit -am "perf: replace debounce with FileSystemWatcher + cache for file suggestions"
```

---

### Task 4.2: Virtual Scrolling Static Analysis (H-6 fix)

**Files:** Read-only static analysis. Update `docs/known-issues.md`.

**H-6 fix:** No unexecutable DOM measurement. Pure static analysis of truncation constants.

- [ ] **Step 1: Static analysis**

`reduceMessages` constants: 200 messages max, 50K chars per message. Estimate: 200 * 50KB = 10MB text, ~20-50 DOM nodes per message = ~10,000 nodes, ~2MB DOM footprint. Total ~10-15MB render cost. Acceptable for v0.2.0. Virtual scrolling deferred to v0.3.0 when sessions regularly exceed 200 messages.

- [ ] **Step 2: Update known-issues.md** -- "DOM size at limits reaches ~15MB. Mitigated by truncation at 200 msgs/50K chars. Virtual scrolling deferred to v0.3.0."
- [ ] **Step 3: Document KI-006 deferral** -- "Deferred to v0.3.0. Works correctly on zsh and PowerShell."
- [ ] **Step 4: Commit**

```bash
git commit -am "docs: add virtual scrolling analysis and KI-006 deferral to known issues"
```

---

### Task 4.3: Shell Detection for KI-006 (M-5 fix)

**Files:**
- Modify: `src/extension.ts` -- add shell detection
- Modify: `docs/known-issues.md` -- document behavior

**M-5 fix:** Detect shell on activation. If unsupported (not zsh/bash/pwsh) and `enableTerminalIntegration: true`, show one-time warning.

- [ ] **Step 1: Add shell detection on activation**

```typescript
import { execSync } from "child_process";

const shell = (execSync("echo $SHELL", { encoding: "utf-8" }).trim().split("/").pop() || "unknown");
const supported = ["zsh", "bash", "pwsh", "powershell"];

if (config.enableTerminalIntegration && !supported.includes(shell)) {
  const key = "pi.terminalShellWarningShown";
  if (!ctx.globalState.get(key)) {
    vscode.window.showWarningMessage(
      `Pi Code: Terminal integration enabled but shell "${shell}" is not fully supported. ` +
      `Supported: zsh, bash, PowerShell. Disable with "pi.enableTerminalIntegration": false.`
    );
    ctx.globalState.update(key, true);
  }
  ctx.log("warn", `KI-006: Unsupported shell "${shell}". Terminal integration may not work.`);
}
```

- [ ] **Step 2: Update known-issues.md KI-006 entry** with detection behavior note
- [ ] **Step 3: Commit**

```bash
git commit -am "feat: shell detection with graceful degradation for unsupported shells (KI-006)"
```

---

## Phase 5: Engineering Excellence

### Task 5.1: Pre-Commit Hook + CI Integration

```bash
npx husky init
echo "npm run format:check && npm run lint && npm run test:unit" > .husky/pre-commit
git add .husky/ && git commit -m "chore: add pre-commit hook for format/lint/test"
```

### Task 5.2: Update delivery-checklist + known-issues

- [ ] **Step 1:** Update delivery-checklist.md -- replace `[Planned: Phase 3.X]` with actual completion status
- [ ] **Step 2:** Update known-issues.md -- add any new issues from implementation
- [ ] **Step 3:** Run final full build with coverage and commit

```bash
npm run compile && npm run test:unit && npm run test:coverage && npm run test:integration && npm run build
git commit -am "v0.2.1: final improvement plan delivery"
```

### Task 5.3: Update TECH_DESIGN.md (F2.11)

Update for:
1. **useReducer architecture** in App.tsx (replaces useState god-object)
2. **PermissionMode single source of truth** in `src/types/permission.ts` with 5 values + migration table
3. **ChatProvider decomposition**: ContextBuilder, GitStatusReader, ChangeTracker
4. **commandClassifier.ts** with Risk types + UX guardrail disclaimer
5. **auditLog** with JSONL persistence + rotation (10MB max, 3 archives)
6. **Command preview async dispatch** pattern with 30s timeout
7. **Updated dependency graph** showing new module relationships

- [ ] **Steps 1-4:** Read, update diagram, update module table, add security subsections
- [ ] **Step 5:** `git add TECH_DESIGN.md && git commit -m "docs: update TECH_DESIGN.md for all architecture changes"`

### Task 5.4: Codebase Mass-Format (H-4 fix)

**Deferred from Phase 0.3.** Run only after all functional changes committed.

- [ ] **Step 1:** `npm run format`
- [ ] **Step 2:** `npm run test:unit && npm run test:integration && npm run build`
- [ ] **Step 3:** `git add src/ test/ && git commit -m "chore: apply Prettier formatting across codebase"`

---

## Global Constraints

- All tests must pass before commits. No new runtime dependencies (devDependencies OK).
- VS Code ^1.85.0 backward compatibility. macOS Apple Silicon, Windows 11 x64, Ubuntu 24.04 x64.
- CSP `default-src 'none'` must NOT be weakened. postMessage kind whitelist must remain intact.
- F-410/411/412 (auto-open, locate, highlight) must remain intact.
- Import changes (Task 1.1) must update dependent test files atomically.
- **CR-2:** `PermissionMode` reconciled atomically across ModesMenu.tsx, Configuration.ts, `src/types/permission.ts`, and package.json in a single commit.
- **CR-3:** Phase 3 dispatch tasks are SEQUENTIAL. All block on Task 1.2. Phase 3.2 blocks on 3.1.
- **CR-1:** Command preview async pattern must include 30s timeout + cleanup on `dispose()`.
- Command classifier is a UX guardrail, NOT a security boundary -- do not claim or imply otherwise.
- Config sanitization at Configuration getter level (point of entry), not just log output.
- pi CLI session files are out of scope for extension-layer sanitization.
- Tasks blocked on pi CLI RPC protocol must NOT be attempted at extension layer.
- Mass-format commit deferred to Task 5.4, not Phase 0.3.
- 80% coverage target on newly tested modules.
