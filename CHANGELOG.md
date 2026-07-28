# Changelog

All notable changes to the Pi Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — Test Coverage, @-Mentions, Security Hardening

### Added

- **@-mention workspace file suggestions** — Type `@` in the chat input to see
  real workspace files (from `vscode.workspace.findFiles` and open editors)
  instead of just model names. Files are refreshed on document open and
  workspace folder changes.
- **Security validation module** (`src/security/validation.ts`) — Provides
  `resolveSafePath()` for workspace path traversal protection (S-004),
  `isSensitiveFile()` for detecting `.env`/`.pem`/credential files (S-005),
  and `sanitizeLogMessage()` for log redaction of API keys and tokens (S-010).
- **Path traversal protection** — DiffController now validates file paths from
  Pi's tool calls against the workspace root before opening or editing files.
- **Log sanitization** — The extension output channel now automatically redacts
  API keys, tokens, authorization headers, and passwords from log messages.
- **Permission mode setting** (`pi.permissionMode`) — Choose between `off`,
  `manual` (confirm each action), or `auto` (default) modes.
- **File suggestions exclude setting** (`pi.fileSuggestionsExclude`) — Custom
  glob patterns to exclude from @-mention autocomplete.
- **Unit tests** — 75 tests now passing (up from 31), covering PiRpcClient
  lifecycle (12 tests), PiEventBus (4 tests), security validation (12 tests),
  RequestQueue edge cases (6 tests), and reduceMessages (19 tests).

### Changed

- **reduceMessages/convertAgentMessages exported** — Message utility functions
  are now exported from `App.tsx` instead of being module-private. The test
  file (`test/unit/reduceMessages.test.ts`) imports them directly instead of
  duplicating the implementation.

### Fixed

- **RequestQueue** — Enhanced with max-size overflow test coverage and
  unknown-id removal handling.

---

## [0.1.1] — F-410/411/412 硬性要求 + 交付文档

### Added

- **F-410: Auto-open file on edit** — DiffController now opens the target file
  when Pi starts editing, so the user can see what's being modified in real time
- **F-411: Auto-scroll to edit location** — On tool completion, scrolls to the
  first changed line in the file editor
- **F-412: Modified line highlighting** — Editor decorations show which lines
  were changed, using VS Code theme colors (diffEditor.insertedLineBackground)
- **S-003: Workspace Trust support** — Untrusted workspaces trigger read-only
  mode with a warning; sets `pi.workspaceTrusted` context key
- `PRD.md` — Comprehensive Product Requirements Document
- `TECH_DESIGN.md` — Technical Architecture Design Document
- `TEST_PLAN.md` — Test Plan covering unit, integration, e2e, and security tests
- `SECURITY.md` — Security documentation (key storage, CSP, path safety, audit)
- `docs/provider-integration-spec.md` — Provider integration specification
- `docs/tool-interface-spec.md` — Tool interface specification
- `docs/configuration-schema.json` — JSON Schema for all Pi Code settings
- `docs/storage-structure.md` — Storage and persistence architecture
- `docs/compatibility-matrix.md` — System compatibility test matrix
- `docs/known-issues.md` — Known issues list
- `docs/ci-cd-workflow.md` — CI/CD release process document
- `docs/test-report.md` — Automated test report (31/31 passing)
- `docs/performance-report.md` — Expected performance benchmarks
- `docs/marketplace-listing.md` — Marketplace listing content with privacy policy
- `docs/build-script.sh` — Reproducible build script
- `.github/workflows/ci.yml` — GitHub Actions CI workflow
- `.github/workflows/release.yml` — GitHub Actions release workflow

### Changed

- Enhanced DiffController with editor decorations and auto-scroll
- Improved extension.ts with Workspace Trust initialization
- Extension bundle updated to 41.7 KiB (was 39.4 KiB)

## [0.1.0] — 2026-07-27

### Added

- Native VS Code chat panel for the Pi coding agent (pi.dev)
- Multi-session tab management for running multiple agent conversations
- Model switching across supported providers with toolbar buttons
- Configurable thinking level control for agent reasoning depth
- @-mention support for referencing files, symbols, and diagnostics
- Slash command menu with quick access to 22+ agent commands
- Inline diff review with accept/reject workflow for agent edits
- Editor title bar buttons for accepting/rejecting proposed diffs
- Editor context menu (right-click "Ask Pi About Selection")
- Integrated terminal support (pi.enableTerminalIntegration)
- Session list sidebar view for managing multiple sessions at a glance
- Auto-create session when chat panel is first opened
- Session persistence and restore across VS Code restarts
- Reopen last closed session (Cmd+Shift+T)
- Focus/blur chat input keyboard shortcut (Cmd+Escape)
- @-mention keyboard shortcut from editor (Alt+K)
- Open Pi Code from editor title bar button
- Show Pi Logs output channel command
- Extension walkthrough/onboarding (4 steps)
- Login/logout/auth status in VS Code status bar
- Streaming response rendering with collapsible thinking blocks
- Visual styling using VS Code theme variables for light/dark theme support
- Session close command (Cmd+Shift+W)
- New session shortcut (Cmd+N when chat focused)

### Settings

- `pi.path` — Path to the `pi` CLI executable
- `pi.defaultProvider` — Default LLM provider
- `pi.defaultModel` — Default model ID/pattern
- `pi.sessionDir` — Directory for session files
- `pi.maxConcurrentSessions` — Max concurrent subprocesses (1-10)
- `pi.enableTerminalIntegration` — Bash tool output forwarding
- `pi.autoReconnect` — Auto-restart Pi subprocess on crash
- `pi.autosaveFiles` — Auto-save dirty files before operations
- `pi.respectGitIgnore` — Respect .gitignore for file operations
