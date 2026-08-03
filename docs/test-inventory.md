# Test Inventory & Coverage Baseline

**Generated:** 2026-07-29  
**Branch:** improvement-v4  
**Task:** Task 0.2 - Test Inventory & Coverage Baseline (M-3 fix)

---

## Summary

| Metric | Value |
|--------|-------|
| Unit Tests | 109 passing |
| Integration Tests | 29 passing |
| **Total Tests** | **138 passing** |
| Unit Coverage (all files) | 43.9% statements |
| Integration Coverage (PiRpcClient) | 85.28% statements |
| **Combined Coverage** | **82.53% statements** |

**Target:** 80% coverage on newly tested modules (Phase 1+)

---

## Unit Test Files (10 files, 109 tests)

| File | Lines | Tests | Coverage | Source Module |
|------|-------|-------|----------|---------------|
| `test/unit/HeaderBar.test.ts` | 22 | 2 | 18.38% | `src/ui/HeaderBar.tsx` |
| `test/unit/PiRpcClient.test.ts` | 213 | 17 | 68.98% | `src/rpc/PiRpcClient.ts` |
| `test/unit/PlanReviewCard.test.ts` | 16 | 2 | 16.25% | `src/ui/PlanReviewCard.tsx` |
| `test/unit/SelectionIndicator.test.ts` | 17 | 3 | N/A | `src/ui/App.tsx` (exported fn) |
| `test/unit/decodeFromWebview.test.ts` | 66 | 11 | 97.04% | `src/view/WebviewMessenger.ts` |
| `test/unit/lineReader.test.ts` | 129 | 13 | 97.95% | `src/rpc/lineReader.ts` |
| `test/unit/parseUnifiedDiff.test.ts` | 69 | 7 | 100% | `src/diff/parseUnifiedDiff.ts` |
| `test/unit/reduceMessages.test.ts` | 546 | 41 | 25.68% | `src/ui/App.tsx` |
| `test/unit/requestQueue.test.ts` | 92 | 6 | 100% | `src/rpc/requestQueue.ts` |
| `test/unit/security.test.ts` | 86 | 13 | 94.84% | `src/security/validation.ts` |

**Total Unit Lines:** 1,156

---

## Integration Test Files (4 files, 29 tests)

| File | Lines | Tests | Scenario Coverage |
|------|-------|-------|-------------------|
| `test/integration/rpc-commands.test.ts` | 136 | 13 | All RPC command types |
| `test/integration/rpc-lifecycle.test.ts` | 128 | 8 | Start/stop/restart/crash |
| `test/integration/rpc-protocol.test.ts` | 77 | 5 | Garbage, concurrent, timing |
| `test/integration/rpc-timeout.test.ts` | 75 | 3 | Timeout scenarios |

**Total Integration Lines:** 416  
**Support File:** `test/integration/mockRpcServer.ts` (218 lines)

---

## Coverage Gaps (1,717 LOC untested)

| Module | LOC | Coverage | Status |
|--------|-----|----------|--------|
| `src/view/ChatProvider.ts` | 419 | 0% | **Untested** |
| `src/session/SessionManager.ts` | 163 | 0% | **Untested** |
| `src/session/PiSession.ts` | 134 | 0% | **Untested** |
| `src/diff/DiffController.ts` | 334 | 0% | **Untested** |
| `src/settings/Configuration.ts` | 127 | 0% | **Untested** |
| `src/auth/AuthService.ts` | 100 | 0% | **Untested** |
| `src/terminal/PiTerminal.ts` | 99 | 0% | **Untested** |
| `src/view/SessionTreeProvider.ts` | 64 | 0% | **Untested** |
| `src/view/PlanContentProvider.ts` | 81 | 0% | **Untested** |
| `src/view/WebviewMessenger.ts` | 203 | 97% | Covered (decode) |
| `src/rpc/types.ts` | 384 | N/A (excluded) | Excluded from coverage |
| `src/ui/App.tsx` | 623 | 25.68% | Partially covered (reduceMessages only) |
| `src/ui/HeaderBar.tsx` | 136 | 18.38% | Partially covered (filterSessions) |
| `src/ui/PlanReviewCard.tsx` | 80 | 16.25% | Partially covered (formatPlanFeedback) |
| `src/ui/Message.tsx` | 258 | 7.36% | **Minimally covered** |
| `src/ui/Toolbar.tsx` | 52 | 30.18% | **Minimally covered** |
| `src/ui/ActionsMenu.tsx` | 219 | 10.59% | **Minimally covered** |
| `src/ui/ModesMenu.tsx` | 197 | 27.41% | **Minimally covered** |
| `src/ui/SlashCommandMenu.tsx` | 74 | 48% | Partially covered |
| `src/ui/MentionsAutocomplete.tsx` | 64 | 23.07% | **Minimally covered** |
| `src/ui/hooks.ts` | 41 | 30.95% | **Minimally covered** |

**Total Untested Source LOC:** ~1,717 (excluding types.ts and already-covered modules)

---

## Coverage by Category

| Category | Statement Coverage | Branch Coverage | Notes |
|----------|-------------------|-----------------|-------|
| **diff/** | 100% | 82.35% | Fully covered |
| **rpc/** | 76.2% | 78.57% | Good (PiRpcClient 68.98%) |
| **security/** | 94.84% | 93.33% | Well covered |
| **ui/** | 21.42% | 90.12% | **Major gap** - React components |
| **view/** | 97.04% | 100% | decodeFromWebview only |
| **session/** | 0% | 0% | **Untested** |
| **auth/** | 0% | 0% | **Untested** |
| **terminal/** | 0% | 0% | **Untested** |
| **settings/** | 0% | 0% | **Untested** |

---

## L-2 Fix Compliance

Per the M-3 fix brief:
- ✅ Only `docs/test-inventory.md` (this file), `package.json`, `.c8rc.json`, and `package-lock.json` are committed
- ✅ No test files added/modified (only inventory documentation)
- ✅ No runtime dependencies added (c8 is devDependency only)
- ✅ CSP `default-src 'none'` not weakened

---

## Next Steps (Phase 1 - Context Assessment)

Priority modules for 80% coverage target:

| Priority | Module | LOC | Rationale |
|----------|--------|-----|-----------|
| P0 | `SessionManager` | 163 | Core session lifecycle |
| P0 | `PiSession` | 134 | RPC bridge, state management |
| P0 | `ChatProvider` | 419 | Central message handling |
| P1 | `DiffController` | 334 | Diff review UX (F-403/F-410) |
| P1 | `Configuration` | 127 | Settings, validation |
| P1 | `AuthService` | 100 | Auth state, login/logout |
| P2 | `PiTerminal` | 99 | Optional terminal integration |
| P2 | `PlanContentProvider` | 81 | Plan review UX |
| P2 | `SessionTreeProvider` | 64 | Session tree view |

---

## Coverage Command

```bash
npm run test:coverage
```

Uses `c8` with config in `.c8rc.json`:
- Reporters: text, lcov
- Includes: `src/**/*.ts`, `src/**/*.tsx`
- Excludes: `src/rpc/types.ts` (type definitions only)