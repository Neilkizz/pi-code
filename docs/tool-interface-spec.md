# 工具接口规范

**Tool Interface Specification**

| 版本 | 日期 | 说明 |
|---|---|---|
| 1.0 | 2026-07-27 | 初稿 |

---

## 1. 架构总览 / Tool Architecture

Pi Code 中的**工具定义和执行完全由 `pi` CLI 负责**。Extension 不实现任何工具逻辑——它通过 JSONL RPC 事件流接收工具执行状态，并提供 VS Code 特定的 UI 渲染：

- **Diff Controller**：为 `edit`/`write` 工具提供快照式 Diff Review（Keep / Revert）
- **PiTerminal**：将 `bash` 工具输出转发到 VS Code 集成终端

```
pi CLI (tool execution)
  │
  │ JSONL event stream
  ▼
PiRpcClient ← PiSession ← SessionManager
  │                              │
  │ tool_execution_start         │ DiffController
  │ tool_execution_update  ────→ │   snapshot files on start
  │ tool_execution_end           │   present diff on end
  │                              │   acceptCurrent / revertCurrent
  │                              │
  │ bash_execution_update ────→ PiTerminal
  │                               forward output to VS Code terminal
```

### 1.1 职责边界 / Responsibility Boundary

| 层 | 职责 |
| --- | --- |
| pi CLI | 定义工具行为、执行工具、生成 diff/patch、返回结果 |
| Pi Code Extension | 监听工具事件、提供 VS Code UI（Diff Viewer、Terminal）、管理权限确认 |
| Webview UI | 显示工具执行状态（进度、结果、错误） |

### 1.2 工具调用生命周期 / Tool Call Lifecycle

```
Agent 决定调用工具
  → pi CLI 发送 tool_execution_start (JSONL)
  → Extension 快照文件（edit/write）或准备 UI
  → pi CLI 执行工具
  → 执行期间可能发送 tool_execution_update
  → pi CLI 发送 tool_execution_end (含结果)
  → Extension 呈现 Diff（edit/write）或更新 UI
```

---

## 2. 工具事件 / Tool Events

所有工具事件通过 RPC 事件流从 pi CLI **推送到** Extension。

### 2.1 tool_execution_start

```typescript
// src/rpc/types.ts
interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;   // 全局唯一，用于匹配 start/update/end
  toolName: string;     // "read" | "write" | "edit" | "bash" | "glob" | "grep" | ...
  args: any;            // 工具参数（结构因工具而异）
}
```

Extension 在此阶段：

- DiffController：为 `edit`/`write` 快照当前文件内容
- Webview：显示工具名称和参数摘要

### 2.2 tool_execution_update

```typescript
interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: any;
  partialResult: any;   // 部分结果（如 bash 的实时输出）
}
```

Extension 在此阶段：

- PiTerminal：将 `bash` 的 `partialResult.text` 转发到 VS Code 终端
- Webview：更新工具执行进度

### 2.3 tool_execution_end

```typescript
interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: ToolResult;   // 最终结果
  isError: boolean;      // 是否执行出错
}
```

Extension 在此阶段：

- DiffController：为 `edit`/`write` 打开 VS Code Diff Editor
- Webview：显示最终结果（文本、错误状态）
- ChatProvider：触发 `pushState()` 更新 UI 状态

### 2.4 bash_execution_update

```typescript
interface BashExecutionUpdateEvent {
  type: "bash_execution_update";
  id?: string;           // 源 bash 命令 ID
  output?: string;       // 实时输出文本
}
```

专用事件，用于 PiTerminal 实时转发 `bash` 工具输出。

---

## 3. 工具实现 / Tool Implementations

所有工具由 pi CLI 实现。以下为 Pi Code 关注的工具签名和结果格式。

### 3.1 read — 读取文件

```typescript
// RPC args (在 tool_execution_start.args 中)
interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

// tool_execution_end.result.content[].text 包含文件内容
// 二进制文件自动跳过，不发送内容
```

### 3.2 write — 写入文件

```typescript
interface WriteArgs {
  file_path: string;
  content: string;
}

// tool_execution_end.result.details (ToolResult.details)
// 可能包含：
//   { file_path: string; bytes_written: number }
```

### 3.3 edit — 编辑文件

```typescript
interface EditArgs {
  file_path: string;
  old?: string;    // 要替换的旧文本
  new?: string;    // 新文本
}

// tool_execution_end.result.details
// 见 EditToolDetails 类型
```

`edit` 工具是 Pi Code 中核心的代码修改工具，其结果包含结构化 diff 信息：

```typescript
// src/rpc/types.ts
interface EditToolDetails {
  /** 面向用户的 diff 文本 */
  diff: string;
  /** 标准 unified diff patch */
  patch: string;
  /** 新文件中第一个变更行行号（用于导航） */
  firstChangedLine?: number;
}

// 完整结果结构
interface ToolResult {
  content: ContentBlock[];
  details?: Record<string, unknown>;  // 包含 EditToolDetails
}
```

### 3.4 bash — 执行命令

```typescript
interface BashArgs {
  command: string;
  description?: string;
  timeout?: number;      // ms
  isInteractive?: boolean;
  requiresApproval?: boolean;
}

// 实时输出通过 tool_execution_update / bash_execution_update 推送
// 最终结果：
//   result.content[].text: stdout
//   result.details: { exitCode, stderr, duration }
```

### 3.5 glob — 文件搜索

```typescript
interface GlobArgs {
  pattern: string;       // glob 模式
  path?: string;         // 搜索起始目录
  ignore?: string[];     // 忽略规则
}

// result.content[].text: 匹配文件列表（每行一个路径）
```

### 3.6 grep — 内容搜索

```typescript
interface GrepArgs {
  pattern: string;       // 搜索模式
  path?: string;         // 搜索目录
  include?: string;      // 包含文件 glob
  exclude?: string;      // 排除文件 glob
  caseSensitive?: boolean;
  regex?: boolean;
  maxResults?: number;
}

// result.content[].text: 匹配行列表
```

---

## 4. Extension 工具处理 / Extension Tool Handling

### 4.1 DiffController — 文件修改审查

`DiffController` 是 Pi Code 的核心 UI 组件，负责将 `edit`/`write` 工具的执行结果呈现为可审阅的 Diff。

```typescript
// src/diff/DiffController.ts — 核心逻辑
private async snapshotOnStart(sessionId: string, e: ToolExecutionStartEvent): Promise<void> {
  const filePath = this.extractPath(e.args);
  if (!filePath) return;
  this.pathByToolCallId.set(e.toolCallId, filePath);
  // 快照当前文件内容到 pi-diff:// 虚拟文档
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  this.snapshotProvider.set(
    this.snapshotUri(sessionId, filePath).toString(),
    doc.getText(),
  );
}

private async presentOnEnd(sessionId: string, e: ToolExecutionEndEvent): Promise<void> {
  const filePath = this.pathByToolCallId.get(e.toolCallId);
  const details = (e.result?.details ?? {}) as Partial<EditToolDetails>;
  // 打开 VS Code Diff Editor（左=快照，右=当前）
  const left = this.snapshotUri(sessionId, filePath);
  const right = vscode.Uri.file(filePath);
  await vscode.commands.executeCommand("vscode.diff", left, right, label, { preview: false });
  // 设置上下文使 Keep/Revert 快捷键生效
  await vscode.commands.executeCommand("setContext", "piDiff", true);
}
```

**工作流程：**

```
tool_execution_start (edit/write)
  → snapshotOnStart(): 读取文件 → 存入 pi-diff:// 虚拟文档
  → perFileBusy 集合防止同一文件的并发快照覆盖

tool_execution_end (edit/write)
  → presentOnEnd(): 解析 EditToolDetails
  → 打开 VS Code diff 编辑器（左=快照，右=实际文件）
  → 用户选择 Keep (无操作) 或 Revert（恢复快照）
  → Revert 时通过 steer 通知 Agent
```

**序列化保证：**

- 每个文件路径有 `perFileBusy` 锁，同一时间只有一个待审查 Diff
- `pathByToolCallId` Map 桥接 start/end 事件
- 空修改（快照与当前文件一致）自动跳过 Diff 展示

**Keep / Revert 命令：**

```typescript
// 注册在 editor/title 菜单和快捷键中
async acceptCurrent(): Promise<void> {
  // 无操作——Pi 的修改保留，清除 busy 锁
}

async revertCurrent(): Promise<void> {
  // 使用 WorkspaceEdit 恢复快照
  // 可选：通过 steer 通知 Agent 回退原因
}
```

### 4.2 PiTerminal — Bash 输出转发

`PiTerminal` 提供可选的 bash 输出实时观察能力：

```typescript
// src/terminal/PiTerminal.ts — 核心逻辑
private onEvent(_sessionId: string, e: T.PiEvent): void {
  if (e.type === "tool_execution_update") {
    const update = e as ToolExecutionUpdateEvent;
    if (update.toolName !== "bash") return;
    const text = this.extractText(update.partialResult);
    if (text && this.terminal) {
      this.terminal.sendText(text, true);
    }
  }
  if (e.type === "bash_execution_update") {
    const bash = e as BashExecutionUpdateEvent;
    const text = typeof bash.output === "string" ? bash.output : this.extractText(bash);
    if (text && this.terminal) {
      this.terminal.sendText(text, true);
    }
  }
}
```

- 默认**关闭**（`pi.enableTerminalIntegration: false`）
- 启用后创建 `Pi` 命名终端
- 实时接收 `tool_execution_update`（bash）和 `bash_execution_update` 事件
- 在终端中输出流式文本

### 4.3 Webview UI — 工具状态展示

Webview（React UI）展示工具执行的实时状态：

| 事件 | UI 表现 |
| --- | --- |
| `tool_execution_start` | 显示工具名称、参数摘要、进度指示 |
| `tool_execution_update` | 更新进度（如 bash 实时输出） |
| `tool_execution_end` | 显示结果或错误标记 |
| `isError = true` | 错误状态高亮 |

Webview 通过 `piEvent` 消息接收事件，由 `ChatProvider` 转发：

```typescript
// ChatProvider.ts — 事件转发
private forward(sessionId: string, e: T.PiEvent): void {
  postToWebview(wv.webview, { kind: "piEvent", sessionId, event: e });
}
```

---

## 5. 工具结果类型 / Tool Result Types

### 5.1 EditToolDetails

```typescript
// src/rpc/types.ts
interface EditToolDetails {
  /** 面向用户的 diff 文本（用于显示） */
  diff: string;
  /** 标准 unified diff patch（用于版本控制） */
  patch: string;
  /** 新文件中第一个变更行行号（编辑器导航用） */
  firstChangedLine?: number;
}
```

`firstChangedLine` 用于 DiffController 打开 diff 编辑器后定位到第一个修改行。

### 5.2 ToolResult

```typescript
interface ContentBlock {
  type: string;        // "text" | "image" | ...
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

interface ToolResult {
  /** 工具结果的内容块 */
  content: ContentBlock[];
  /** 结构化元数据（工具特定） */
  details?: Record<string, unknown>;
}
```

### 5.3 各工具 result 形状 / Per-Tool Shape

| 工具 | result.content | result.details |
| --- | --- | --- |
| `read` | `[{ type: "text", text: "..." }]` | `{ file_path, truncated? }` |
| `write` | `[{ type: "text", text: "已写入 N 字节" }]` | `{ file_path, bytes_written }` |
| `edit` | `[{ type: "text", text: "已修改 N 行" }]` | `{ diff, patch, firstChangedLine }` (EditToolDetails) |
| `bash` | `[{ type: "text", text: stdout }]` | `{ exitCode, stderr, duration }` |
| `glob` | `[{ type: "text", text: "path1\npath2\n..." }]` | `{ pattern, matchCount }` |
| `grep` | `[{ type: "text", text: "匹配行..." }]` | `{ pattern, matchCount }` |

---

## 6. 权限模型 / Permission Model for Tools

Pi Code 根据所选权限模式决定对每种工具的处理策略。

### 6.1 权限模式 / Permission Modes

| 模式 | 描述 |
| --- | --- |
| **Read-Only** | 仅允许 read / glob / grep；write / edit / bash 被拒绝 |
| **Plan** | 允许所有读取和搜索工具；write / edit / bash 被拒绝 |
| **Manual** | 每个 write / edit / bash 执行前要求用户确认 |
| **Auto** | 工作区文件自动执行；危险命令（删除、提权、git 强制）仍需确认 |

权限模式通过 VS Code 设置或 Workspace Trust 自动降级：

```
Workspace Trust RESTRICTED
  → 强制降级为 Read-Only
  → 拒绝所有 write/edit/bash 工具
```

### 6.2 工具权限矩阵 / Tool Permission Matrix

| 工具 | Read-Only | Plan | Manual | Auto |
| --- | --- | --- | --- | --- |
| `read` | OK | OK | OK | OK |
| `glob` | OK | OK | OK | OK |
| `grep` | OK | OK | OK | OK |
| `write` | BLOCKED | BLOCKED | CONFIRM | OK (注1) |
| `edit` | BLOCKED | BLOCKED | CONFIRM | OK (注1) |
| `bash` | BLOCKED | BLOCKED | CONFIRM | CONFIRM (注2) |

注：

1. Auto 模式下 `write`/`edit` 对工作区文件自动执行
2. Auto 模式下 `bash` **危险命令**仍需确认（删除、提权、`git push --force`、系统配置修改等）

### 6.3 权限实现 / Implementation

权限决策在 **pi CLI 侧**执行（不可绕过），Extension 负责 UI 展示确认对话框：

```typescript
// 示意：Manual 模式下 Extension 显示的确认对话框
const choice = await vscode.window.showWarningMessage(
  `Pi wants to edit: ${filePath}`,
  { modal: true, detail: "Diff preview available after execution." },
  "Allow",
  "Deny",
);
if (choice !== "Allow") {
  // 通过 steer 通知 Agent 被拒绝
  await session.steer(`The edit to ${filePath} was rejected.`);
  return;
}
```

### 6.4 危险命令定义 / Dangerous Commands

以下 bash 命令在 Auto 模式下仍需确认：

| 类别 | 示例 |
| --- | --- |
| 删除 | `rm -rf`, `del`, `rmdir` |
| 提权 | `sudo`, `su`, `chmod 777` |
| Git 强制 | `git push --force`, `git reset --hard`, `git clean -fdx` |
| 系统配置 | `systemctl`, `ufw`, `iptables` |
| 网络下载 | `curl ... | bash`,`wget ... -O - | sh` |
| 包管理全局安装 | `npm install -g`, `pip install --system` |
