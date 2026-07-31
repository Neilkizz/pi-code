# Pi Desktop Cleanup, Security Hardening & UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up legacy VS Code extension code and obsolete docs, harden core security & host logic in `packages/pi-agent-host`, and redesign `apps/desktop` with a modern 3-pane Claude/ChatGPT Desktop parity UI/UX.

**Architecture:** Monorepo focused on `apps/desktop` (Tauri + React + Vite frontend) communicates over JSON-RPC with `packages/pi-agent-host` (Node host managing `@earendil-works/pi-coding-agent` and terminal/Git execution) using schema types from `packages/protocol`.

**Tech Stack:** TypeScript, React 18, Vite, Tauri v2, Tailwind/CSS Variables, `@earendil-works/pi-coding-agent`, Vitest.

## Global Constraints

- No VS Code Extension API or `vscode` package dependencies in any active runtime code.
- All high-risk commands evaluated by `CommandClassifier` before execution.
- No background `setInterval` polling timers in `AuditLog` — rotation checked synchronously on `record()`.
- Environment variables filtered via `EnvInheritance.filterEnv()` for child process/Git invocations.
- All file watcher cache invalidations must immediately trigger `pushFileSuggestions()`.

---

### Task 1: Engineering Cleanup & Workspace Monorepo Alignment

**Files:**
- Delete: `src/` (legacy VS Code extension code)
- Delete: `webview/`
- Delete: `webview.webpack.config.js`, `.vscodeignore`, `pi-code-0.2.0.vsix`
- Delete: `docs/superpowers/plans/2026-07-29-pi-code-improvement-plan-v4.md`, `...-v3.md`, `...-revised.md`, `....md`
- Delete: `docs/plan-a3-rpc-integration-test.md`, `docs/plan-a4-e2e-framework.md`, `docs/plan-a5-medium-low-issues.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Monorepo package scripts in `apps/desktop/package.json` and `packages/*/package.json`.
- Produces: Cleaned root `package.json` with desktop-focused build and test scripts.

- [ ] **Step 1: Delete legacy VS Code extension directories and files**

Run command to remove legacy VS Code extension directories and files:
```bash
rm -rf src webview webview.webpack.config.js .vscodeignore pi-code-0.2.0.vsix
```

- [ ] **Step 2: Remove obsolete plan and intermediate docs**

Run command to delete obsolete docs:
```bash
rm -f docs/superpowers/plans/2026-07-29-pi-code-improvement-plan*.md
rm -f docs/superpowers/plans/2026-07-28-claude-code-ui-1to1-replica.md
rm -f docs/plan-a3-rpc-integration-test.md docs/plan-a4-e2e-framework.md docs/plan-a5-medium-low-issues.md
```

- [ ] **Step 3: Update root package.json for Desktop App workflows**

Update root `package.json` to clean out VS Code metadata (`engines.vscode`, `main`, `activationEvents`, etc.) and add clean workspace scripts:
```json
{
  "name": "pi-desktop-monorepo",
  "version": "0.3.0",
  "private": true,
  "scripts": {
    "desktop:dev": "npm --prefix apps/desktop run dev",
    "desktop:build": "npm --prefix apps/desktop run build",
    "host:build": "npm --prefix packages/pi-agent-host run build",
    "protocol:build": "npm --prefix packages/protocol run build",
    "test": "npm --prefix apps/desktop run test:unit",
    "typecheck": "tsc --noEmit -p apps/desktop/tsconfig.json"
  }
}
```

- [ ] **Step 4: Verify directory state and run typecheck**

Run: `npm run typecheck`
Expected: PASS (or no type errors in desktop/packages)

- [ ] **Step 5: Commit Cleanup**

```bash
git add .
git commit -m "chore: remove legacy VS Code extension code, obsolete docs and align root package.json"
```

---

### Task 2: Core Security & Host Logic Hardening

**Files:**
- Modify: `packages/pi-agent-host/src/security/AuditLog.ts`
- Modify: `packages/pi-agent-host/src/security/CommandClassifier.ts`
- Modify: `packages/pi-agent-host/src/security/EnvInheritance.ts`
- Modify: `apps/desktop/src/services/FileSystemWatcher.ts`
- Test: `apps/desktop/src/__tests__/security.test.ts`

**Interfaces:**
- Consumes: Host RPC event dispatchers and file system watcher events.
- Produces: Hardened security audit log (no unref intervals), strict command risk classification, sanitized env inheritance, and immediate file suggestion push.

- [ ] **Step 1: Write unit tests for AuditLog, CommandClassifier, and EnvInheritance**

Create/update `apps/desktop/src/__tests__/security.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { CommandClassifier } from '../../../packages/pi-agent-host/src/security/CommandClassifier';
import { EnvInheritance } from '../../../packages/pi-agent-host/src/security/EnvInheritance';

describe('Security Modules', () => {
  it('classifies destructive commands correctly', () => {
    const classifier = new CommandClassifier();
    expect(classifier.classify('rm -rf /')).toBe('destructive');
    expect(classifier.classify('ls -la')).toBe('read-only');
  });

  it('filters sensitive environment variables', () => {
    const rawEnv = { PATH: '/usr/bin', AWS_SECRET_ACCESS_KEY: 'secret123', HOME: '/Users/test' };
    const filtered = EnvInheritance.filterEnv(rawEnv);
    expect(filtered.PATH).toBe('/usr/bin');
    expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify initial state / failure**

Run: `npm --prefix apps/desktop run test:unit -- security.test.ts`
Expected: Pass or fail highlighting missing methods.

- [ ] **Step 3: Refactor AuditLog to remove background interval polling**

In `packages/pi-agent-host/src/security/AuditLog.ts`:
Remove `setInterval(() => this.checkRotation(), 30_000)` from the constructor. Retain `this.checkRotation()` call inside `record(entry: AuditLogEntry)`.

- [ ] **Step 4: Update FileSystemWatcher to immediately trigger suggestion push**

In `apps/desktop/src/services/FileSystemWatcher.ts` (or `ChatProvider` watcher integration):
Ensure file creation/deletion callbacks call `pushFileSuggestions()` immediately after `invalidateFileSuggestionsCache()`.

- [ ] **Step 5: Run tests to verify security fixes**

Run: `npm --prefix apps/desktop run test:unit`
Expected: PASS

- [ ] **Step 6: Commit Security Hardening**

```bash
git add packages/pi-agent-host apps/desktop
git commit -m "fix(security): optimize AuditLog rotation, enforce command risk classifier & immediate watcher suggestion push"
```

---

### Task 3: Desktop UI/UX HeaderBar, Sidebar & 3-Pane Layout Redesign

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/HeaderBar.tsx`
- Modify: `apps/desktop/src/components/Sidebar.tsx`
- Create: `apps/desktop/src/components/InspectorPane.tsx`
- Modify: `apps/desktop/src/styles/app.css`

**Interfaces:**
- Consumes: Session state and settings state from `AppStore` / React Context.
- Produces: 200px collapsible sidebar, draggable App HeaderBar with Model/Workspace selector, and collapsible Inspector Pane.

- [ ] **Step 1: Write UI component tests for 3-pane layout toggle**

Create `apps/desktop/src/__tests__/Layout.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppLayout } from '../components/AppLayout';

describe('AppLayout 3-Pane UI', () => {
  it('renders Sidebar, HeaderBar, Main Chat area, and Inspector Pane', () => {
    render(<AppLayout />);
    expect(screen.getByRole('navigation')).toBeDefined();
    expect(screen.getByTestId('inspector-pane')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm --prefix apps/desktop run test:unit -- Layout.test.tsx`
Expected: FAIL (AppLayout not defined)

- [ ] **Step 3: Implement 3-Pane Responsive Layout in App.tsx & AppLayout**

Structure `apps/desktop/src/App.tsx` with:
- Top HeaderBar (Draggable region, App Title, Model Dropdown, Workspace indicator, Settings gear)
- Left Sidebar (Fixed 200px width, collapsible, Session creation & history tree)
- Main Area (Chat Timeline + Floating Composer)
- Right Inspector Pane (Tabs for Change Tracker Diff, Step Progress, Audit Log)

- [ ] **Step 4: Add CSS variables for Theme & High Contrast / Glassmorphism**

In `apps/desktop/src/styles/app.css`:
Define CSS Custom Properties for `--bg-primary`, `--bg-secondary`, `--bg-composer`, `--border-color`, `--text-primary`, `--text-secondary`, and `@media (prefers-reduced-motion)` fallbacks.

- [ ] **Step 5: Run UI unit tests**

Run: `npm --prefix apps/desktop run test:unit -- Layout.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit Layout Redesign**

```bash
git add apps/desktop
git commit -m "feat(ui): implement 3-pane Claude Desktop parity layout with responsive sidebar & inspector pane"
```

---

### Task 4: Floating Composer & Message Timeline UI/UX Enhancements

**Files:**
- Modify: `apps/desktop/src/components/FloatingComposer.tsx` (or `InputArea.tsx`)
- Modify: `apps/desktop/src/components/MessageTimeline.tsx` (or `Message.tsx`)
- Modify: `apps/desktop/src/components/MentionsAutocomplete.tsx`
- Modify: `apps/desktop/src/components/ToolEventCard.tsx`

**Interfaces:**
- Consumes: User prompt input, mentions file list, tool execution stream.
- Produces: Auto-expanding composer with `@` mentions, Markdown rendering with GFM, code block copy/expand, and collapsible tool event execution cards.

- [ ] **Step 1: Write component tests for FloatingComposer keyboard & mention handlers**

Create `apps/desktop/src/__tests__/FloatingComposer.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FloatingComposer } from '../components/FloatingComposer';

describe('FloatingComposer', () => {
  it('triggers send on Enter and newline on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<FloatingComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello Pi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Hello Pi');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm --prefix apps/desktop run test:unit -- FloatingComposer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement FloatingComposer with glassmorphism & auto-expand**

Enhance `FloatingComposer`:
- Add auto-height calculation (max-height 200px) based on `scrollHeight`.
- Wire `@` key listener to show `MentionsAutocomplete` popup anchored above the cursor/textarea.
- Add attachment badge bar and Model mode quick selector.

- [ ] **Step 4: Enhance Message Timeline Markdown & Tool Event Cards**

Enhance `MessageTimeline`:
- Use `react-markdown` with GFM plugin for headings, tables, task lists, and quotes.
- Wrap code blocks in custom code container with "Copy" button and syntax badge.
- Render Tool Call Events in `ToolEventCard` with collapsible input/output parameters and pulse loading state during execution.

- [ ] **Step 5: Run tests to verify Composer & Timeline features**

Run: `npm --prefix apps/desktop run test:unit`
Expected: PASS

- [ ] **Step 6: Commit Floating Composer & Timeline Enhancements**

```bash
git add apps/desktop
git commit -m "feat(ui): add floating glassmorphism composer, markdown GFM timeline & interactive tool event cards"
```

---

### Task 5: Final Quality Verification & E2E Validation

**Files:**
- All packages & apps in repo

**Interfaces:**
- Consumes: Complete codebase build output.
- Produces: Verified production-ready Pi Desktop application bundle and passing test suite.

- [ ] **Step 1: Run typecheck across desktop app**

Run: `npm run typecheck`
Expected: PASS (0 errors)

- [ ] **Step 2: Run complete unit test suite**

Run: `npm run test`
Expected: PASS (100% tests passing)

- [ ] **Step 3: Build Host and Desktop App**

Run: `npm run host:build && npm run desktop:build`
Expected: Successful Vite build output in `apps/desktop/dist`

- [ ] **Step 4: Final Commit**

```bash
git add .
git commit -m "chore: complete Pi Desktop cleanup, security hardening, and UI redesign"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/specs/2026-07-31-pi-desktop-cleanup-and-ui-redesign-spec.md` (and plan in progress). Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you like to take?
