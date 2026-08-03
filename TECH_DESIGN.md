# Pi Code — 技术设计文档 (TECH_DESIGN)

**版本:** 1.1  
**状态:** 正式发布  
**最后更新:** 2026-07-29  

---

## 1. 架构总览

Pi Code 采用五层解耦架构，模块间通过类型化接口通信：

```
┌─────────────────────────────────────────────────────┐
│                    VS Code Extension Host            │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │   Chat    │  │ Session  │  │    Terminal       │  │
│  │ Provider  │  │  Tree    │  │    Integration    │  │
│  └─────┬─────┘  └──────────┘  └───────────────────┘  │
│        │                                              │
│  ┌─────▼───────────────────────────────────────┐     │
│  │            Session Manager                    │     │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │     │
│  │  │Session 1│ │Session 2│ │Session N│        │     │
│  │  │(PiRpc)  │ │(PiRpc)  │ │(PiRpc)  │        │     │
│  │  └────┬────┘ └────┬────┘ └────┬────┘        │     │
│  └───────┼───────────┼───────────┼──────────────┘     │
│          │           │           │                     │
│  ┌───────▼───────────▼───────────▼──────────────┐     │
│  │           Diff Controller                     │     │
│  │  (Snapshot → Diff Editor → Accept/Revert)    │     │
│  └──────────────────────────────────────────────┘     │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │           Auth Service                        │     │
│  │  (Status Bar / Login / Logout)               │     │
│  └──────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
                         │ JSONL (stdin/stdout)
                         ▼
┌──────────────────────────────────────────────────────┐
│              pi CLI (--mode rpc)                      │
│   Agent Loop · Tool Execution · LLM Integration       │
└──────────────────────────────────────────────────────┘
```

### 1.1 模块职责

| 模块 | 源码位置 | 职责 |
| --- | --- | --- |
| **Extension Host** | `src/extension.ts` | VS Code API 入口，初始化所有模块 |
| **Configuration** | `src/settings/Configuration.ts` | 强类型配置读取，支持动态变更 |
| **Commands** | `src/settings/Commands.ts` | 注册所有 contributes.commands |
| **Session Manager** | `src/session/SessionManager.ts` | 多会话生命周期管理，持久化 |
| **Pi Session** | `src/session/PiSession.ts` | 单个会话（一个子进程），状态管理 |
| **PiRpcClient** | `src/rpc/PiRpcClient.ts` | JSONL RPC 协议实现，子进程管理 |
| **RequestQueue** | `src/rpc/requestQueue.ts` | 子进程断线时请求排队 |
| **LineReader** | `src/rpc/lineReader.ts` | 严格 LF-only JSONL 行读取器 |
| **Chat Provider** | `src/view/ChatProvider.ts` | WebviewViewProvider，事件转发，命令分类/审计/确认 |
| **Webview Messenger** | `src/view/WebviewMessenger.ts` | 类型化 postMessage 协议 |
| **Session Tree** | `src/view/SessionTreeProvider.ts` | 侧栏会话列表面板 |
| **Diff Controller** | `src/diff/DiffController.ts` | 快照式 Diff Review |
| **Auth Service** | `src/auth/AuthService.ts` | 授权状态管理（通过 pi CLI） |
| **Pi Terminal** | `src/terminal/PiTerminal.ts` | 终端集成和 bash 输出转发 |
| **UI (React)** | `src/ui/*.tsx` | Webview 渲染层 |
| **ContextBuilder** | `src/view/ContextBuilder.ts` | 构建上下文项（文件/选择/诊断）和文件建议 |
| **GitStatusReader** | `src/view/GitStatusReader.ts` | 读取工作区 Git 状态（分支/变更数） |
| **ChangeTracker** | `src/view/ChangeTracker.ts` | 追踪工具执行中的文件修改，生成变更摘要 |
| **AppState** | `src/ui/AppState.ts` | useReducer 状态管理，AppAction 类型系统，reduceMessages |

---

## 2. RPC 协议设计

Pi Code 通过 JSONL（JSON Lines，LF 分隔）与 `pi --mode rpc` 子进程通信。

### 2.1 协议特性

- **严格 LF 分隔:** 仅以 `\n` (0x0A) 分隔记录，不兼容 Node `readline`（因 U+2028/U+2029 是有效 JSON 字符）
- **请求/响应:** 每个命令携带唯一 `id`，响应以 `{"id":"...","type":"response","success":true/false}` 返回
- **事件流:** 非 response 行均为流式事件，通过 PiEvent 联合类型派发

### 2.2 命令类型

```typescript
type RpcCommand =
  | PromptCommand      // 发送提示词
  | SteerCommand       // 引导进行中 Agent
  | FollowUpCommand    // 后续追问
  | AbortCommand       // 中断
  | NewSessionCommand  // 创建新会话
  | GetStateCommand    // 获取状态
  | GetMessagesCommand // 获取历史消息
  | SetModelCommand    // 设置模型
  | CycleModelCommand  // 切换模型
  | GetAvailableModelsCommand
  | SetThinkingLevelCommand  // 设置推理级别
  | SetSessionNameCommand;   // 命名会话
```

### 2.3 事件类型

```typescript
type PiEvent =
  | AgentStartEvent          // Agent 开始处理
  | AgentEndEvent            // Agent 结束
  | AgentSettledEvent        // Agent 稳定（无更多工具调用）
  | TurnStartEvent           // 新回合开始
  | TurnEndEvent             // 回合结束
  | MessageStartEvent        // 消息开始（含 role）
  | MessageUpdateEvent       // 消息更新（text/thinking delta）
  | MessageEndEvent          // 消息结束
  | ToolExecutionStartEvent  // 工具开始执行
  | ToolExecutionUpdateEvent // 工具执行更新
  | ToolExecutionEndEvent    // 工具执行结束
  | QueueUpdateEvent         // 队列状态更新
  | CompactionStartEvent     // 上下文压缩开始
  | CompactionEndEvent       // 上下文压缩结束
  | AutoRetryStartEvent      // 自动重试开始
  | AutoRetryEndEvent        // 自动重试结束
  | ExtensionErrorEvent      // 扩展错误
  | BashExecutionUpdateEvent // bash 执行更新
```

### 2.4 流式状态机

每个 RPC 请求拥有独立状态机：

```
idle → waiting_response → (streaming_events) → response_received → idle
```

关键规则：

- `message_stop` 只能结束已开始的消息
- 按 toolCallId 精确匹配工具调用的 start/update/end
- 重复/迟到事件被幂等处理
- 首字节后可重试但绝不断流拼接

### 2.5 U+2028/U+2029 防护

Node `readline` 错误地将 U+2028（行分隔符）和 U+2029（段分隔符）视为行终止符，但这些字符在 JSON 字符串字面量中是合法的。Pi Code 使用 `JsonlLineReader` 严格只在 `\n` 处分行，并使用 `TextDecoder` 流式解码以正确处理跨块的多字节 UTF-8 序列。

---

## 3. 关键模块设计

### 3.1 PiRpcClient

```
┌──────────────────────────────────────┐
│            PiRpcClient               │
├──────────────────────────────────────┤
│ - child: ChildProcess                │
│ - pending: Map<id, PendingRequest>   │
│ - queue: RequestQueue                │
│ - alive: boolean                     │
│ - restartCount: number               │
├──────────────────────────────────────┤
│ + start()                            │
│ + prompt() / steer() / abort()       │
│ + setModel() / cycleModel()          │
│ + onEvent(handler)                   │
│ + dispose()                          │
└──────────────────────────────────────┘
```

- **自动重启:** 子进程崩溃后指数退避重试（250ms → 5s），最多 5 次
- **请求超时:** 默认 30s，可配置
- **请求排队:** 子进程离线时请求排队，恢复后按 FIFO 发送
- **优雅关闭:** SIGTERM → 2s → SIGKILL
- **环境继承:** `inheritEnv` 控制是否继承 `process.env`（默认 true），`env` 提供额外或独占环境变量

### 3.2 SessionManager

```
┌──────────────────────────────────────┐
│           SessionManager             │
├──────────────────────────────────────┤
│ - sessions: Map<id, PiSession>       │
│ - order: string[]                    │
│ - activeId: string | null            │
│ - closedSessionStack: string[]       │
├──────────────────────────────────────┤
│ + create(parent?)                    │
│ + forkActive()                       │
│ + close(id)                          │
│ + setActive(id)                      │
│ + reopenLastClosed()                 │
│ + restoreSaved()                     │
│ + persistTabs()                      │
└──────────────────────────────────────┘
```

- **会话持久化:** tab 列表存在 `globalState` 的 `pi.tabs` 键中
- **子进程恢复:** 重新创建会话时通过 `--session-id <id>` 让 pi CLI 恢复
- **最大并发:** 默认 3，可配置 1-10
- **关闭堆栈:** 支持 Cmd+Shift+T 恢复最后关闭的会话

### 3.3 DiffController

```
┌──────────────────────────────────────┐
│           DiffController             │
├──────────────────────────────────────┤
│ - current: PendingDiff | null        │
│ - perFileBusy: Set<string>           │
│ - pathByToolCallId: Map              │
├──────────────────────────────────────┤
│ + acceptCurrent()                    │
│ + revertCurrent()                    │
│ + onEvent() → snapshot/present       │
└──────────────────────────────────────┘
```

**Post-hoc Diff 设计：**
Pi RPC 模式下 `edit`/`write` 工具直接写入文件后才返回 diff。DiffController 采用"事后审查"设计：

1. `tool_execution_start` 时快照文件内容
2. `tool_execution_end` 时打开 VS Code Diff Editor（左=快照，右=当前）
3. 用户选择 Keep（无操作）或 Revert（恢复快照）
4. Revert 时发送 steer 通知 Agent

### 3.4 Webview UI (React)

```
+-------------------------------------+
|         Chat Webview (React)         |
+-------------------------------------+
|  App.tsx (useReducer + dispatch)     |
|   +--- AppState (reducer/actions)    |
|   +--- Toolbar (model/thinking/abort) |
|   +--- HeaderBar (session/mode)      |
|   +--- MessageList/MessageItem        |
|   |    +--- InlineMarkdown            |
|   |    +--- ThinkingBlock             |
|   |    +--- ConfirmCard (risk)        |
|   +--- InputArea                      |
|        +--- MentionsAutocomplete      |
|        +--- SlashCommandMenu          |
+-------------------------------------+
|  hooks.ts - VsCodeApi bridge          |
|  style.css - Theme variable styling   |
+-------------------------------------+
```

- **useReducer (v1.1):** AppState.ts with appReducer + AppAction union replaces multiple useState calls
- **ConfirmCard (v1.1):** Danger/sensitive command confirmation with risk badge, 30s auto-cancel
- **ModesMenu (v1.1):** readonly/plan/manual/auto/bypass modes, shield icon for read-only
- **vsCode API:** acquireVsCodeApi() postMessage bridge
- **Markdown:** heading/bold/italic/link/list/blockquote/code block
- **Thinking block:** Collapsible reasoning display
- **Theme:** VS Code theme CSS variables throughout

### 3.5 消息传递协议

```
┌───────────┐          postMessage          ┌───────────┐
│ Extension  │ ──────────────────────────►  │  Webview  │
│  (Host)    │   HostToWebview              │  (React)  │
│            │ ◄──────────────────────────  │           │
│            │   WebviewToHost              │           │
└───────────┘                               └───────────┘
```

**Host → Webview (typed):**

- `stateSnapshot` — 会话状态快照
- `piEvent` — Pi 事件流
- `modelList` — 可用模型列表
- `history` — 历史消息
- `commandPreview` — 命令预览（风险等级+确认ID）（v1.1）
- `fileSuggestions` — 文件建议列表
- `gitStatus` — Git 状态摘要
- `contextUpdate` — 上下文项更新
- `changeSummary` — 变更摘要

**Webview → Host (kind 白名单校验):**

- `prompt` / `steer` / `abort`
- `setModel` / `cycleModel` / `setThinkingLevel`
- `login` / `logout`
- `acceptDiff` / `rejectDiff`
- `confirmCommand` / `cancelCommand` — 命令确认/取消（v1.1）
- `requestFileSuggestions`

---

## 4. 安全设计

### 4.1 密钥管理

- API Key 不进入扩展代码路径
- Pi CLI 通过 `~/.pi/credentials` 管理凭据
- AuthService 不存储或代理 API Key

### 4.2 Webview CSP

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               style-src ${csp} 'unsafe-inline';
               script-src ${csp};
               img-src ${csp} data:;" />
```

### 4.3 消息验证

`decodeFromWebview()` 使用 kind 白名单拒绝所有未注册消息类型。VS Code 自身沙箱限制 iframe 权限。

### 4.4 路径安全

- Configuration 中的路径参数均通过 VS Code API 规范化
- 工作区根目录以外路径默认禁止访问
- `.gitignore` 默认遵守

### 4.5 权限模式（v1.1）

PermissionMode 单一事实来源定义在 `src/types/permission.ts`，5 种模式：

| 模式 | 行为 |
| --- | --- |
| `readonly` | 阻止所有写操作，仅读命令 |
| `plan` | 只读探索，阻止写操作 |
| `manual` | 每个命令手动确认（尤其安全文件） |
| `auto` | 自动允许安全/敏感命令，危险命令需确认（默认） |
| `bypass` | 隐藏模式，跳过所有安全检查 |

Configuration 中从旧版 `"off"` 自动迁移到 `"readonly"`，带一次性通知。

### 4.6 命令分类器（v1.1）

`src/security/commandClassifier.ts` 实现最佳努力 UX 防护栏，不是安全边界：

- **危险模式:** `rm -rf /`, `sudo`, `chmod 777`, `dd`, `mkfs`, `git push --force`, pipe-to-shell
- **敏感模式:** `rm`, `mv`, `chmod`/`chown`, `docker rm`, `git reset`/`rebase`, `npm publish`/`pip install`
- 危险→所有非 bypass 模式需确认；敏感→仅在 manual 模式需确认

### 4.7 审计日志（v1.1）

`src/security/auditLog.ts` 实现 JSONL 持久化审计：

- 每条记录：时间戳+类型+详情+风险+授权状态
- 内存 1000 条上限（FIFO 淘汰）
- 磁盘文件超过 10MB 时轮转，保留 3 个存档（audit.1.jsonl..audit.3.jsonl）
- 30 秒定期 flush 间隔

### 4.8 配置脱敏（v1.1）

Configuration getter 入口点使用 `sanitizeLogMessage()` 对 `executable` 和 `sessionDir` 进行脱敏处理（API Key/Token/Authorization Header 正则替换）。`defaultProvider` 和 `defaultModel` 为 schema 控制的值，不脱敏。

---

## 5. 存储设计

### 5.1 VS Code 存储 API

| 存储类型 | 用途 |
| --- | --- |
| `globalState` | 会话 tab 列表 (`pi.tabs`) |
| `workspaceState` | 当前工作区设置 |
| `secrets` | 敏感信息（当前版本未使用，pi CLI 自行管理） |
| 输出通道 | `Pi Code` 日志通道 |

### 5.2 持久化格式

```
globalState:
  "pi.tabs": string[]  // 活跃会话 ID 列表

pi CLI 管理:
  ~/.pi/credentials/   // Provider 凭据
  ~/.pi/agent/sessions/ // 会话文件（JSONL）
```

---

## 6. 依赖关系

```
session.PiSession
  └── rpc.PiRpcClient
       ├── rpc.lineReader
       └── rpc.requestQueue
view.ChatProvider
  ├── view.ContextBuilder (context items, file suggestions)
  ├── view.GitStatusReader (git status)
  ├── view.ChangeTracker (file change tracking)
  ├── security.commandClassifier (risk classification)
  ├── security.AuditLog (JSONL audit log)
  └── session.SessionManager
       └── session.PiSession
diff.DiffController
  └── session.SessionManager
       └── session.PiSession
auth.AuthService
  └── session.SessionManager
terminal.PiTerminal
  └── session.SessionManager
       └── session.PiSession
security.commandClassifier (standalone, no deps)
security.AuditLog (standalone, fs dependency only)
```

无循环依赖。所有模块通过 ExtensionContext 接口注入，可测性好。

### 6.1 v1.1 新增模块

| 新增模块 | 职责 |
| --- | --- |
| `view/ContextBuilder.ts` | 从 ChatProvider 提取的上下文项和文件建议构建器 |
| `view/GitStatusReader.ts` | 从 ChatProvider 提取的 Git 状态读取器 |
| `view/ChangeTracker.ts` | 从 ChatProvider 提取的文件变更追踪器 |
| `ui/AppState.ts` | useReducer 状态管理和 action 类型系统 |
| `types/permission.ts` | PermissionMode 单一事实来源 |
| `security/commandClassifier.ts` | 命令风险分类（UX 防护栏） |
| `security/auditLog.ts` | JSONL 审计日志 + 轮转 |
| `ui/ConfirmCard.tsx` | Webview 命令确认卡片 |

---

## 7. 外部依赖

| 依赖 | 用途 | 版本 |
| --- | --- | --- |
| `pi` CLI | Agent 运行时和 LLM 集成 | 外部（由用户安装） |
| VS Code API | 扩展宿主 API | ^1.85.0 |
| React 18 | Webview UI | ^18.2.0 |
| Webpack 5 | 构建打包 | ^5.90.0 |
| TypeScript 5 | 类型系统和编译 | ^5.3.0 |
| Mocha 10 | 单元测试 | ^10.2.0 |
| ts-node | 测试运行 | ^10.9.2 |
