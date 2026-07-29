# Pi Code Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Systematically improve Pi Code VS Code extension from v0.2.0 to production-ready, addressing test gaps, code quality, missing delivery features, and architectural debt.

**Architecture:** Five-layer decoupled extension (Extension Host → Session Manager → PiRpcClient → pi CLI subprocess) with React webview UI. Improvement plan spans testing infrastructure, code decomposition, feature completion, and performance optimization.

**Tech Stack:** TypeScript 5, React 18, VS Code API ^1.85.0, Webpack 5, Mocha 10, Node >=18

## Global Constraints

- All tests must pass before commits
- No new external runtime dependencies (devDependencies OK)
- VS Code ^1.85.0 backward compatibility
- Must maintain support for macOS Apple Silicon, Windows 11 x64, Ubuntu 24.04 x64
- All existing 75 unit tests must continue to pass
- F-410/411/412 (auto-open, locate, highlight) must remain intact
- CSP `default-src 'none'` must not be weakened
- postMessage kind whitelist must remain intact

---

### Phase 1: Testing Infrastructure

#### Task 1: RPC Integration Test Framework

**Files:**
- Modify: `test/integration/mockRpcServer.ts` — add session/event routing, error simulation
- Create: `test/integration/rpc-request-lifecycle.test.ts`
- Create: `test/integration/rpc-event-stream.test.ts`
- Create: `test/integration/rpc-concurrent-sessions.test.ts`
- Create: `test/integration/rpc-error-recovery.test.ts`

**Interfaces:**
- Consumes: `PiRpcClient`, `PiEventBus`, `RequestQueue`, `JsonlLineReader`, `mockRpcServer`
- Produces: 4 new integration test files with 20+ test scenarios

- [ ] **Step 1: Read current mockRpcServer.ts to understand gaps**

```bash
cat test/integration/mockRpcServer.ts
```

- [ ] **Step 2: Enhance mockRpcServer with session routing, event injection, error simulation**

Add capabilities:
- Route events to specific session IDs
- Inject arbitrary event sequences (T-001 through T-012)
- Simulate connection drops and restarts
- Configurable response latency

- [ ] **Step 3: Write rpc-request-lifecycle.test.ts**

Test scenarios:
1. Simple prompt → response with agent_start/agent_end events
2. Request timeout → error
3. Auto-reconnect after process death
4. Queue drain after reconnect
5. Concurrent requests don't cross-talk

- [ ] **Step 4: Write rpc-event-stream.test.ts**

Test scenarios (T-001 through T-012):
1. Normal stream: message_start → text_delta → message_end
2. Dual tool: tool1_start → tool2_start → tool1_end → tool2_end
3. Duplicate agent_end (idempotent)
4. Partial JSON chunk reassembly
5. U+2028/U+2029 inside JSON strings
6. Empty stream handling
7. Compaction events interleaved with tool events

- [ ] **Step 5: Write rpc-concurrent-sessions.test.ts**

Test:
1. Two sessions, events from A don't reach B
2. Three sessions, sequential prompts don't cross
3. Mixed event types across sessions

- [ ] **Step 6: Write rpc-error-recovery.test.ts**

Test:
1. Process crash → restart → pending drain
2. Process crash → restart limit exceeded → error
3. stdin write failure → logged, not thrown
4. Flush trailing line on death

- [ ] **Step 7: Run all integration tests**

```bash
npm run test:integration
# Expected: 20+ integration tests pass
```

- [ ] **Step 8: Commit**

```bash
git add test/integration/
git commit -m "test: add RPC integration test framework with 20+ scenarios"
```

---

#### Task 2: Extension Layer Unit Tests

**Files:**
- Create: `test/unit/SessionManager.test.ts`
- Create: `test/unit/ChatProvider.test.ts`
- Modify: `test/unit/PiRpcClient.test.ts` — add lifecycle tests
- Modify: `test/unit/requestQueue.test.ts` — add edge cases

**Interfaces:**
- Consumes: `SessionManager`, `ChatProvider`, `PiRpcClient`, `RequestQueue`
- Produces: 2 new test files, ~50 new test cases

- [ ] **Step 1: Write SessionManager unit tests**

Test:
1. `create()` → creates session, sets active, persists
2. `create()` → throws at maxConcurrent limit
3. `close()` → disposes, updates order, persists
4. `setActive()` → updates activeId, fires event
5. `forkActive()` → creates with parent file
6. `restoreSaved()` → re-creates from persisted tabs
7. `reopenLastClosed()` → restores from stack
8. `getSessionRoot()` → multi-root handling (F-111)

- [ ] **Step 2: Write ChatProvider dispatch tests**

Cover every branch:
1. prompt → s.prompt() with text + images
2. steer → s.steer()
3. abort → s.abort()
4. setModel → s.setModel() + pushState()
5. cycleModel → s.cycleModel() + pushState()
6. setThinkingLevel → s.setThinkingLevel() + pushState()
7. login → s.prompt("/login")
8. logout → s.prompt("/logout")
9. acceptDiff → diff.acceptCurrent()
10. rejectDiff → diff.revertCurrent()
11. requestFileSuggestions → pushFileSuggestions()
12. removeContextItem → pushContext()
13. Unknown kind → no-op

- [ ] **Step 3: Extend PiRpcClient lifecycle tests**

Add:
1. `start()` spawns with correct args
2. `start()` no-op if already alive
3. `dispose()` kills process, cleans timers
4. `dispose()` safe to call multiple times
5. Auto-restart max 5 attempts
6. Exponential backoff: 250→500→1s→2s→5s

- [ ] **Step 4: Extend RequestQueue edge cases**

Add:
1. `clear()` with pending timer → timer cleaned
2. `remove()` with unknown id → no-op
3. Queue at 1000 limit → reject

- [ ] **Step 5: Run all tests**

```bash
npm run test:unit
```

- [ ] **Step 6: Commit**

```bash
git add test/unit/
git commit -m "test: add SessionManager and ChatProvider unit tests (+50 cases)"
```

---

### Phase 2: Code Decomposition

#### Task 3: App.tsx Decomposition (~623 → modules)

**Files:**
- Create: `src/ui/messageReducer.ts` — reduceMessages, convertAgentMessages, helpers
- Create: `src/ui/WelcomeScreen.tsx`
- Create: `src/ui/InputArea.tsx`
- Modify: `src/ui/App.tsx` — slim to ~250 lines

**Interfaces:**
- Consumes: Existing `HostToWebview`, `WebviewToHost`, `PiEvent`, `DisplayMessage`
- Produces: Focused modules ~150 lines each

- [ ] **Step 1: Extract messageReducer.ts**

Move: `reduceMessages()`, `convertAgentMessages()`, `textFromMsg()`, `textFromResult()`, `formatSelectionBadge()`, `DisplayMessage` interface.

- [ ] **Step 2: Extract WelcomeScreen.tsx**

Move `WelcomeScreen` component and `WelcomeScreenProps` type.

- [ ] **Step 3: Extract InputArea.tsx**

Move input area + @-mention + slash command + drag-drop handlers.

- [ ] **Step 4: Verify App.tsx targets ~250 lines**

Only layout composition and state management remain.

- [ ] **Step 5: Run tests and build**

```bash
npm run compile && npm run test:unit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/
git commit -m "refactor: split App.tsx into messageReducer, WelcomeScreen, InputArea"
```

---

### Phase 3: Missing Delivery Features

#### Task 4: Sensitive Command Detection (F-512)

**Files:**
- Create: `src/security/commandClassifier.ts`
- Modify: `src/settings/Configuration.ts`
- Wire into permission mode

**Produced interface:**
```typescript
type CommandRisk = 'safe' | 'sensitive' | 'dangerous';
interface Classification { risk: CommandRisk; reason?: string; }
function classifyCommand(cmd: string): Classification;
```

- [ ] **Step 1: Implement commandClassifier.ts**

Dangerous patterns: `rm -rf /`, `sudo`, `chmod 777`, `dd`, `mkfs`, `git push --force`, pipe-to-shell

Sensitive patterns: `rm`, `mv`, `chmod/chown`, `docker rm`, `git reset/rebase`, `npm publish`, `pip install`

- [ ] **Step 2: Wire into permission mode**

`auto` mode: dangerous → confirm dialog, sensitive → auto-allow, safe → auto-allow
`manual` mode: any command → confirm
`off` mode: skip checks

- [ ] **Step 3: Add unit tests**

8 test cases covering all risk levels.

- [ ] **Step 4: Commit**

```bash
git add src/security/ && git commit -m "feat: sensitive command detection (F-512)"
```

---

### Phase 4: Performance

#### Task 5: Debounce pushFileSuggestions

**Files:**
- Modify: `src/view/ChatProvider.ts`

- [ ] **Step 1: Add debounce wrapper**

500ms debounce on `onDidOpenTextDocument` handler.

- [ ] **Step 2: Add cache key**

Skip findFiles if workspace hasn't changed (checksum workspace root mtime).

- [ ] **Step 3: Commit**

```bash
git commit -m "perf: debounce pushFileSuggestions with 500ms delay"
```

---

### Phase 5: Engineering Excellence

#### Task 6: Prettier + ESLint + Husky

**Files:**
- Create: `.prettierrc`
- Modify: `package.json`

- [ ] **Step 1: Create .prettierrc**

- [ ] **Step 2: Format codebase**

```bash
npx prettier --write "src/**/*.{ts,tsx}" "test/**/*.ts"
```

- [ ] **Step 3: Set up pre-commit hook**

```bash
npx husky init
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: add Prettier + husky pre-commit hook"
```
