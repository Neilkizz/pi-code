# Provider 集成规范

**Provider Integration Specification**

| 版本 | 日期 | 说明 |
|---|---|---|
| 1.0 | 2026-07-27 | 初稿 |

---

## 1. 架构总览 / Provider Architecture

Pi Code **不直接集成任何 LLM Provider**。所有 Provider 通信、模型交互、API 密钥管理、重试和故障转移均由 `pi` CLI (pi.dev) 在子进程中处理。Pi Code 仅作为 VS Code 前端，通过 JSONL-over-stdio RPC 协议向 `pi` CLI 发送命令并接收事件流。

```
┌──────────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                        │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  ChatProvider (Webview UI)                               │     │
│  │    ↓ setModel / cycleModel / getAvailableModels          │     │
│  │  PiSession → PiRpcClient (JSONL stdin/stdout)            │     │
│  └──────────────────────┬────────────────────────────────────┘     │
└──────────────────────────┼──────────────────────────────────────────┘
                           │ JSONL RPC
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    pi CLI (--mode rpc)                            │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Provider Adapter Layer                                   │     │
│  │    ├── Anthropic Messages API                             │     │
│  │    ├── OpenAI Chat Completions                            │     │
│  │    ├── OpenAI Responses API                               │     │
│  │    ├── OpenAI-compatible endpoints                        │     │
│  │    └── CLIProxyAPI (custom + model mapping)               │     │
│  │                                                           │     │
│  │  Agent Loop · Tool Execution · Context Management          │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 职责边界 / Responsibility Boundary

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| Pi Code (Extension) | 模型选择 UI、切换命令、状态展示 | Provider 连接、API 调用、密钥存储 |
| pi CLI (Subprocess) | Provider 适配、流式通信、重试、故障转移 | VS Code API、Diff Viewer、编辑器集成 |

### 1.2 RPC 命令映射 / Command Mapping

Extension 发送的模型相关命令通过 `PiRpcClient` 序列化为 JSONL，pi CLI 解析后操作 Provider Adapter Layer。

```typescript
// PiRpcClient.ts — typed RPC wrappers
async setModel(provider: string, modelId: string): Promise<ModelInfo> {
  return this.request<ModelInfo>({ type: "set_model", provider, modelId });
}
async cycleModel(direction: "next" | "prev"): Promise<CycleModelData> {
  return this.request<CycleModelData>({ type: "cycle_model", direction });
}
async getAvailableModels(): Promise<AvailableModelsData> {
  return this.request<AvailableModelsData>({ type: "get_available_models" });
}
async setThinkingLevel(level: ThinkingLevel): Promise<void> {
  await this.request<void>({ type: "set_thinking_level", level });
}
```

---

## 2. Provider 适配层 / Provider Adapter Layer

Provider Adapter Layer 位于 `pi` CLI 内部，Pi Code 不包含任何 Provider 适配代码。pi CLI 统一将各 Provider 的原生 SSE/HTTP 响应转换为内部标准事件流。

### 2.1 支持的 Provider 协议 / Supported Protocols

| 协议 | 最低能力要求 |
| --- | --- |
| Anthropic Messages API | 流式文本、工具调用、thinking 块、stop_reason、usage |
| OpenAI Chat Completions | 流式文本、function/tool calling、usage |
| OpenAI Responses API | 多事件流、工具调用、响应状态 |
| OpenAI-compatible | 自定义 base URL、模型名、请求头 |
| CLIProxyAPI | 自定义端点、模型映射、凭据轮换、兼容性日志 |

### 2.2 统一内部事件 / Unified Internal Events

每个 Provider Adapter 必须将原始协议转换为以下标准事件，供 Agent Core 消费：

```
message-start
  ├── text-delta
  ├── reasoning-delta (thinking block)
  ├── tool-call-start
  ├── tool-call-delta (incremental JSON)
  ├── tool-call-end
  ├── tool-result
usage
message-end
error
```

UI 和 Agent Core **不得**直接依赖某个 Provider 的原始 SSE 格式——这是 pi CLI 内部的适配职责。

### 2.3 Provider 配置 / Provider Configuration

pi CLI 通过其自有配置系统管理 Provider 凭据（`~/.pi/credentials/`），API Key 不进入 Extension 代码路径。

```
~/.pi/credentials/
  ├── anthropic       # API Key / OAuth
  ├── openai
  ├── google
  └── cliproxy/       # 自定义端点配置
```

---

## 3. 扩展配置 / Provider Configuration via Extension Settings

Pi Code 在 `package.json` 中定义了 Provider 相关配置项，通过 `Configuration` 类读取并转换为 `pi` CLI 启动参数。

### 3.1 配置项 / Settings Properties

```jsonc
// package.json contributes.configuration
{
  "pi.defaultProvider": {
    "type": "string",
    "default": "",
    "description": "Default LLM provider (anthropic, openai, google, ...). Empty = use Pi's default."
  },
  "pi.defaultModel": {
    "type": "string",
    "default": "",
    "description": "Default model id or pattern (provider/id). Empty = use Pi's default."
  }
}
```

### 3.2 CLI 参数传递 / CLI Arg Passing

```typescript
// Configuration.ts
extraArgs(): string[] {
  const args: string[] = [];
  if (this.defaultProvider) args.push("--provider", this.defaultProvider);
  if (this.defaultModel) args.push("--model", this.defaultModel);
  if (this.sessionDir) args.push("--session-dir", this.sessionDir);
  return args;
}
```

启动子进程时：

```typescript
const args = ["--mode", "rpc", ...extraArgs()];
const child = spawn(executable, args, { /* ... */ });
```

### 3.3 会话级覆盖 / Session-Level Override

Extension 通过 RPC 运行时修改模型，不重启子进程：

```typescript
// Webview → Host → PiSession → PiRpcClient → pi CLI
case "setModel":
  await s.setModel(msg.provider, msg.modelId);
  break;
case "cycleModel":
  await s.cycleModel(msg.direction);
  break;
case "setThinkingLevel":
  await s.setThinkingLevel(msg.level);
  break;
```

---

## 4. 模型命令 / Model Commands in RPC

### 4.1 set_model

```typescript
// RPC Command
interface SetModelCommand {
  type: "set_model";
  provider: string;
  modelId: string;
}

// RPC Response
type SetModelResponse = ModelInfo;
```

- 切换当前会话的 Provider 和模型
- pi CLI 内部处理 Provider 凭据切换
- 返回当前选中的 `ModelInfo`

### 4.2 cycle_model

```typescript
interface CycleModelCommand {
  type: "cycle_model";
  direction?: "next" | "prev";
}

interface CycleModelData {
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
}
```

- 按 pi CLI 内部的可用模型列表循环切换
- `isScoped` 指示是否在工作区范围内限制了可选模型
- UI 侧通过 `CycleModelData` 更新模型选择器状态

### 4.3 get_available_models

```typescript
interface GetAvailableModelsCommand {
  type: "get_available_models";
}

interface AvailableModelsData {
  models: ModelInfo[];
}

interface ModelInfo {
  id: string;
  provider: string;
  label?: string;
  [key: string]: unknown;
}
```

- 返回所有已配置 Provider 的可用模型列表
- 用于 UI 下拉选择器
- 只读缓存操作，不触发 Provider 连接

### 4.4 set_thinking_level

```typescript
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface SetThinkingLevelCommand {
  type: "set_thinking_level";
  level: ThinkingLevel;
}
```

- 设置推理/思考深度
- 仅在当前 Provider 支持时生效
- pi CLI 可能根据 Provider 能力静默降级

---

## 5. 事件流 / Event Flow

### 5.1 模型切换流程 / Model Switch Flow

```
User clicks model in UI
  → Webview emits { kind: "setModel", provider, modelId }
  → ChatProvider.dispatch() → PiSession.setModel()
  → PiRpcClient.request({ type: "set_model", provider, modelId })
  → JSONL write to pi CLI stdin
  → pi CLI validates provider/config, switches adapter
  → pi CLI writes { id, type: "response", success: true, data: ModelInfo }
  → Extension resolves promise → pushState() updates webview
```

### 5.2 流式 Prompt 事件流 / Streaming Prompt Flow

```
User sends prompt
  → Webview emits { kind: "prompt", text }
  → PiRpcClient.request({ type: "prompt", message })
  → pi CLI connects to Provider via its adapter
  → pi CLI streams events back via JSONL:

  { type: "message_start", message: { role: "assistant", content: [] } }
  { type: "message_update", message: {...}, assistantMessageEvent: { type: "thinking_delta", delta: "..." } }
  { type: "message_update", message: {...}, assistantMessageEvent: { type: "text_delta", delta: "..." } }
  { type: "tool_execution_start", toolCallId, toolName, args }
  { type: "tool_execution_end", toolCallId, toolName, result, isError }
  { type: "message_end", message }
  { type: "turn_end", message, toolResults }
  { id, type: "response", command: "prompt", success: true }

  → Extension forwards piEvent to webview via postMessage
  → Webview React renders streaming deltas in real-time
```

### 5.3 Provider 错误处理 / Provider Error Handling

Provider 错误完全由 pi CLI 内部处理：

| 场景 | pi CLI 行为 |
| --- | --- |
| DNS/TLS 失败（首字节前） | 自动重试或故障转移 |
| 429/5xx（首字节前） | 透明重试，可能切换备用模型 |
| 首字节后断流 | 保留已收到内容，标记不完整 |
| 模型不可用 | 返回错误响应，Extension 显示错误消息 |

Extension 仅接收以下事件以反映 Provider 状态：

```typescript
// pi CLI → Extension 的重试事件
interface AutoRetryStartEvent {
  type: "auto_retry_start";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

interface AutoRetryEndEvent {
  type: "auto_retry_end";
  success: boolean;
  attempt: number;
  finalError?: string;
}

// pi CLI → Extension 的扩展错误事件
interface ExtensionErrorEvent {
  type: "extension_error";
  [key: string]: unknown;
}
```

---

## 6. 配置优先级 / Configuration Priority

### 6.1 优先级层级 / Priority Hierarchy

```
1. 会话临时覆盖 (highest)
   └── set_model RPC 调用，仅影响当前会话

2. 工作区配置
   └── .vscode/settings.json 中的 pi.* 设置

3. 全局配置
   └── VS Code User settings.json 中的 pi.* 设置

4. pi CLI 默认值 (lowest)
   └── pi CLI 自身的 --provider / --model 默认值
```

### 6.2 具体规则 / Specific Rules

```typescript
// pi CLI 启动时的参数来源
// Configuration.extraArgs() 读取工作区+全局配置 → CLI args
extraArgs(): string[] {
  const args: string[] = [];
  if (this.defaultProvider) args.push("--provider", this.defaultProvider);
  if (this.defaultModel) args.push("--model", this.defaultModel);
  return args;
}
```

1. 子进程启动时：`pi --mode rpc --provider <defaultProvider> --model <defaultModel>`
2. 运行时切换：`set_model` RPC 命令覆盖当前会话的 Provider/Model
3. 工作区配置优先于全局配置（VS Code 的 `WorkspaceConfiguration` 自动处理此优先级）
4. 空字符串或无配置时：不传 CLI 参数，使用 pi CLI 默认值

### 6.3 配置生效时机 / Configuration Timing

| 变更类型 | 生效方式 |
| --- | --- |
| 修改 pi.defaultProvider / pi.defaultModel | 下次启动子进程时生效（新建会话） |
| UI 切换模型 | 立即通过 RPC set_model 生效 |
| 关闭并重新打开 VS Code | 从 globalState 恢复会话，pi CLI 使用 CLI 参数或 session 文件记录的模型 |
