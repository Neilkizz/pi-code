# Pi Code — Data Storage Structure / 数据存储结构

**Version:** 1.0  
**Status:** Final  
**Last updated:** 2026-07-27  

---

## Overview / 概述

Pi Code uses two storage layers: **VS Code's built-in storage APIs** (for extension state) and **the `pi` CLI's file-based storage** (for sessions and credentials). There is no separate database — the extension relies entirely on VS Code's own persistence mechanisms.

Pi Code 使用两层存储：**VS Code 内置存储 API**（用于扩展状态）和 **`pi` CLI 的文件存储**（用于会话和凭据）。没有独立的数据库——扩展完全依赖 VS Code 自身的持久化机制。

---

## 1. VS Code globalState / VS Code 全局状态

### 1.1 Active Session Tabs / 活动会话标签页

| Key | Type | Description | Description (ZH) |
| --- | --- | --- | --- |
| `pi.tabs` | `string[]` | Ordered array of active session tab IDs. Persisted across VS Code restarts. | 活动会话标签页 ID 的有序数组。在 VS Code 重启后持久化。 |

**Storage API used:**

```typescript
import { ExtensionContext } from "vscode";

// Write
context.globalState.update("pi.tabs", ["session-abc", "session-def"]);

// Read
const tabs: string[] = context.globalState.get("pi.tabs", []);
```

**Lifecycle:**

- **Create:** When a new session is created, its ID is appended to `pi.tabs`
- **Close:** When a session is closed, its ID is removed from `pi.tabs`
- **Restore:** On extension activation, `pi.tabs` is read to restore session tabs
- **No data loss:** Only tab metadata is stored here. Full session history lives on disk.

**生命周期：**

- **创建：** 新会话创建时，其 ID 追加到 `pi.tabs`
- **关闭：** 会话关闭时，其 ID 从 `pi.tabs` 移除
- **恢复：** 扩展激活时，读取 `pi.tabs` 恢复会话标签页
- **无数据丢失：** 此处仅存储标签页元数据。完整会话历史保存在磁盘上。

### 1.2 Closed Session Stack / 已关闭会话堆栈

| Key | Type | Description | Description (ZH) |
| --- | --- | --- | --- |
| `pi.closedSessions` | `string[]` | Stack of recently closed session IDs for reopen support. | 最近关闭的会话 ID 堆栈，用于重新打开支持。 |

**Reopen workflow:**

1. User closes a session tab
2. Session ID is pushed onto `pi.closedSessions`
3. User presses `Cmd/Ctrl+Shift+T`
4. The top of the stack is popped and the session ID passes to `pi --session-id <id>` to restore
5. The restored tab is appended to `pi.tabs`

**重新打开流程：**

1. 用户关闭会话标签页
2. 会话 ID 推入 `pi.closedSessions`
3. 用户按下 `Cmd/Ctrl+Shift+T`
4. 弹出栈顶并通过 `pi --session-id <id>` 恢复会话
5. 恢复的标签页追加到 `pi.tabs`

### 1.3 Other globalState Keys / 其他 globalState 键

| Key | Type | Description | Description (ZH) |
| --- | --- | --- | --- |
| `pi.version` | `string` | Last known extension version for migration detection. | 上次已知的扩展版本，用于迁移检测。 |
| `pi.authStatus` | `string` | Cached authentication status. | 缓存的身份验证状态。 |

---

## 2. VS Code workspaceState / VS Code 工作区状态

| Key | Type | Description | Description (ZH) |
| --- | --- | --- | --- |
| `pi.workspaceConfig` | `string` | Workspace-level Pi Code configuration overrides. | 工作区级别的 Pi Code 配置覆盖。 |

---

## 3. File-Based Storage (Managed by `pi` CLI) / 文件存储（由 `pi` CLI 管理）

Pi Code does **not** directly read or write session or credential files. All file-level storage is delegated to the `pi` CLI subprocess.

Pi Code **不直接**读写会话或凭据文件。所有文件级存储都委托给 `pi` CLI 子进程。

### 3.1 Credentials / 凭据

```
~/.pi/credentials/
  ├── anthropic          # Anthropic API key
  ├── openai             # OpenAI API key
  ├── google             # Google AI API key
  ├── ...                # Other providers
```

- Each file contains the raw API key for that provider
- Managed exclusively by `pi auth login` and `pi auth logout` commands
- No secrets are exposed to the extension or webview
- 每个文件包含该提供商的原始 API 密钥
- 完全由 `pi auth login` 和 `pi auth logout` 命令管理
- 密钥不会暴露给扩展或 webview

### 3.2 Session Files / 会话文件

```
~/.pi/agent/sessions/
  ├── session-abc.jsonl    # Session messages in JSONL format
  ├── session-def.jsonl
  ├── ...
```

- **Format:** JSON Lines (one JSON object per line, LF-delimited)
- **Content:** Full message history including user prompts, assistant responses, tool calls, tool results, and metadata
- **Naming:** Session ID matches the value used in `pi.tabs` and `--session-id` CLI argument
- **Pi Code involvement:** Only passes the session ID via `--session-id` when launching `pi --mode rpc`; the CLI manages reading and writing
- **格式：** JSON Lines（每行一个 JSON 对象，LF 分隔）
- **内容：** 完整消息历史，包括用户提示、助手响应、工具调用、工具结果和元数据
- **命名：** 会话 ID 与 `pi.tabs` 和 `--session-id` CLI 参数使用的值一致
- **Pi Code 参与：** 仅在启动 `pi --mode rpc` 时通过 `--session-id` 传入会话 ID；CLI 管理读写操作

#### Session File Example / 会话文件示例

```jsonl
{"type":"user","content":"Find all TODO comments in the codebase","timestamp":"2026-07-27T10:00:00Z"}
{"type":"assistant","content":"I'll search for TODO comments...","timestamp":"2026-07-27T10:00:01Z"}
{"type":"tool_call","id":"call-1","tool":"grep","args":{"pattern":"TODO"},"timestamp":"2026-07-27T10:00:01Z"}
{"type":"tool_result","id":"call-1","result":"src/main.ts:42: // TODO: refactor this","timestamp":"2026-07-27T10:00:02Z"}
```

---

## 4. Extension Output Channel / 扩展输出通道

| Channel | ID | Description | Description (ZH) |
| --- | --- | --- | --- |
| Pi Code | `pi-code` | Dedicated VS Code output channel for extension logs. | 专用于扩展日志的 VS Code 输出通道。 |

**Log content includes / 日志内容包括：**

- Extension activation/deactivation events / 扩展激活/停用事件
- RPC connection lifecycle / RPC 连接生命周期
- Session management operations / 会话管理操作
- Error stack traces (sanitized) / 错误堆栈追踪（已脱敏）
- Permission decisions / 权限决策
- Provider/model change events / 提供商/模型变更事件
- Performance metrics (RTT, restart count) / 性能指标（RTT、重启次数）

**Not logged / 不记录：**

- User prompts / 用户提示
- File contents / 文件内容
- API keys or tokens / API 密钥或令牌
- Command outputs / 命令输出

---

## 5. No Database / 无数据库

Pi Code does **not** use any of the following:

- SQLite
- IndexedDB (no webview local storage dependencies)
- LevelDB
- Any third-party storage engine

All persistent state is managed through:

1. VS Code `ExtensionContext.globalState` (key-value)
2. VS Code `ExtensionContext.workspaceState` (key-value)
3. VS Code `ExtensionContext.secrets` (encrypted, currently unused — delegated to `pi` CLI)
4. `pi` CLI file storage (`~/.pi/credentials/`, `~/.pi/agent/sessions/`)

Pi Code **不使用**以下任何存储引擎：

- SQLite
- IndexedDB（不依赖 webview 本地存储）
- LevelDB
- 任何第三方存储引擎

所有持久化状态通过以下方式管理：

1. VS Code `ExtensionContext.globalState`（键值对）
2. VS Code `ExtensionContext.workspaceState`（键值对）
3. VS Code `ExtensionContext.secrets`（加密存储，当前未使用——委托给 `pi` CLI）
4. `pi` CLI 文件存储（`~/.pi/credentials/`、`~/.pi/agent/sessions/`）

---

## 6. Storage Diagram / 存储架构图

```
┌─────────────────────────────────────────────────────────┐
│                  VS Code Extension Host                   │
│                                                           │
│  globalState                    workspaceState             │
│  ┌──────────────────┐          ┌──────────────────┐       │
│  │ pi.tabs: string[] │          │ workspaceConfig  │       │
│  │ pi.closedSessions │          └──────────────────┘       │
│  │ pi.version        │                                     │
│  │ pi.authStatus     │          secrets                    │
│  └──────────────────┘          ┌──────────────────┐       │
│                                 │ (reserved,       │       │
│  Output Channel                 │  currently       │       │
│  ┌──────────────────┐          │  unused)         │       │
│  │ Pi Code (logs)   │          └──────────────────┘       │
│  └──────────────────┘                                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   File System (pi CLI)                    │
│                                                           │
│  ~/.pi/credentials/         ~/.pi/agent/sessions/         │
│  ┌──────────────────┐      ┌────────────────────────┐    │
│  │ anthropic        │      │ session-abc.jsonl      │    │
│  │ openai           │      │ session-def.jsonl      │    │
│  │ google           │      │ ...                    │    │
│  │ ...              │      └────────────────────────┘    │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Migration / 数据迁移

When the extension version changes, migration logic reads `pi.version` from `globalState`:

```typescript
const prevVersion = context.globalState.get<string>("pi.version");
if (prevVersion !== currentVersion) {
  // Run migration steps
  // ...
  context.globalState.update("pi.version", currentVersion);
}
```

Session files on disk are handled entirely by the `pi` CLI. The extension only manages tab references.

当扩展版本变更时，迁移逻辑读取 `globalState` 中的 `pi.version`：

```typescript
const prevVersion = context.globalState.get<string>("pi.version");
if (prevVersion !== currentVersion) {
  // 执行迁移步骤
  // ...
  context.globalState.update("pi.version", currentVersion);
}
```

磁盘上的会话文件完全由 `pi` CLI 管理。扩展仅管理标签页引用。

---

## 8. Cleanup / 清理

- **Session deletion:** When a user deletes a session from the UI, the Session Manager sends a delete request to `pi` CLI, which removes the corresponding `.jsonl` file. The tab ID is removed from `pi.tabs`.
- **Extension uninstall:** VS Code automatically removes `globalState` and `workspaceState`. Session files and credentials managed by `pi` CLI are **not** affected.
- **会话删除：** 用户从 UI 删除会话时，会话管理器向 `pi` CLI 发送删除请求，CLI 移除对应的 `.jsonl` 文件。标签页 ID 从 `pi.tabs` 中移除。
- **扩展卸载：** VS Code 自动移除 `globalState` 和 `workspaceState`。由 `pi` CLI 管理的会话文件和凭据**不受影响**。
