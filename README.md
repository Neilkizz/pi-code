# Pi Code — AI Coding Agent for VS Code

[![Version](https://img.shields.io/badge/version-0.1.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC)]()

Pi Code brings the [Pi coding agent](https://pi.dev) into VS Code as a native chat panel. Full tool-use, streaming, multi-session conversations, and inline diff review — all inside your editor.

---

## Features

- **Chat panel** — Native VS Code chat interface powered by the `pi` CLI
- **Multi-session tabs** — Run multiple agent sessions side by side
- **Model switching** — Switch between different models on the fly
- **Thinking level control** — Adjust how much reasoning the agent shows
- **@-mentions** — Reference files, symbols, terminals, and problems directly in the chat
- **Slash command menu** — Quick access to common agent commands
- **Diff review** — Accept or reject code edits with inline diff decorations
- **Terminal integration** — Agent can run shell commands and see terminal output

---

## Requirements

- `pi` CLI must be installed on your system (see [pi.dev](https://pi.dev) for installation instructions)
- Node.js >= 18
- VS Code ^1.85.0

---

## Quick Start

1. Install the `pi` CLI from [pi.dev](https://pi.dev)
2. Install the Pi Code extension from the VS Code Marketplace
3. Open the Pi Code chat panel (`Ctrl+Shift+P` > "Pi Code: Open Chat")
4. Start coding with AI assistance

### Configuration

The most important setting is `pi.path`, which tells the extension where to find the `pi` CLI binary. By default, the extension searches your `PATH`, but you can set it explicitly:

```json
{
  "pi.path": "/usr/local/bin/pi"
}
```

---

## Extension Settings

Pi Code contributes the following settings:

| Setting | Default | Description |
| --------- | --------- | ------------- |
| `pi.path` | `"pi"` | Path to the `pi` executable. Set to an absolute path if `pi` is not on PATH. |
| `pi.defaultProvider` | `""` | Default LLM provider (anthropic, openai, google…). Empty = use Pi's default. |
| `pi.defaultModel` | `""` | Default model id or pattern (provider/id). Empty = use Pi's default. |
| `pi.sessionDir` | `""` | Directory for Pi session files. Empty = Pi default (`~/.pi/agent/sessions`). |
| `pi.maxConcurrentSessions` | `3` | Maximum number of concurrent Pi subprocesses (one per session tab). Range: 1–10. |
| `pi.enableTerminalIntegration` | `false` | Forward bash tool output to a dedicated Pi terminal. |
| `pi.autoReconnect` | `true` | Automatically restart the Pi subprocess if it crashes. |

---

## Screenshots

![Chat Panel](https://via.placeholder.com/800x450.png?text=Pi+Code+Chat+Panel)

*The main chat panel showing an active agent conversation.*

![Multi-Session Tabs](https://via.placeholder.com/800x450.png?text=Multi-Session+Tabs)

*Multiple agent sessions managed in parallel tabs.*

![Diff Review](https://via.placeholder.com/800x450.png?text=Diff+Review)

*Inline diff decorations for reviewing agent code changes.*

---

## Known Limitations

- The `pi` CLI must be installed separately — it is not bundled with the extension
- Performance on large workspaces may vary depending on the underlying model
- Some advanced `pi` CLI features may not yet be exposed in the chat panel
- Terminal integration requires a supported shell and VS Code's integrated terminal

---

## License

MIT
