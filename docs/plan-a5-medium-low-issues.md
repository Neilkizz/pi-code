# A5: 修复 Medium / Low 级别遗留问题 — 实施方案

**版本:** 0.2  
**状态:** 方案细化 / 待实施  
**相关文件:** docs/known-issues.md, REVIEW_REPORT.md, 交付标准.md

---

## 1. 问题总览

从 `docs/known-issues.md` 和 `REVIEW_REPORT.md` 中梳理出的**当前仍开放**的中低级别问题：

| ID | 问题 | 严重度 | 模块 | 当前状态 | 动作 |
|----|------|--------|------|----------|------|
| KI-001 | @-mentions 内容消毒 | Medium | `src/ui/MentionsAutocomplete.tsx` | Open — 缺失显式消毒 | 修复 |
| KI-006 | 终端集成 Shell 兼容性 | Medium | `src/terminal/PiTerminal.ts` | Open — 非默认 shell 用户体验不完全 | 修复 |
| KI-008 | 高级 CLI 功能未在面板中暴露 | Low | `src/ui/SlashCommandMenu.tsx` | Open — 缺少部分斜杠命令 | 增强 |
| M1 | QueryState port/self-init 旧代码 | — | 代码库 | 已确认不存在（grep 无结果） | 关闭 |
| KI-005 | 无内置 MCP 服务器 | Low | 架构 | By design — 委托给 `pi` CLI | 不处理 |
| KI-007 | 大工作区性能受模型影响 | Medium | pi CLI | 非扩展层可控 | 不处理 |

**实际处理范围:** 3 个 issue — KI-001, KI-006, KI-008

---

## 2. KI-001: @-mentions 内容消毒 (Medium)

### 2.1 问题分析

`MentionsAutocomplete` 直接从工作区获取文件路径并在 UI 中渲染：

```tsx
<span>{item}</span>      // React JSX 自动转义 HTML（安全）
onPick(items[selectedIdx])  // 路径输入到聊天输入框
```

**当前保护层：**
- React JSX 默认转义 HTML 实体（`<`→`&lt;`）
- 严格的 CSP 阻止内联脚本执行
- 聊天输入框内容发送到 pi 时经过 JSON 序列化

**剩余风险：**
- 文件路径中的特殊字符（`$`, `` ` ``, `"`）如果原样进入 prompt 可能被下游处理误解
- 没有显式的消毒步骤，依赖框架保护是隐含行为

### 2.2 实现方案

**步骤 1:** 在 `src/security/validation.ts` 中添加消毒函数

```typescript
/**
 * Sanitize a file path or symbol name for display in the UI.
 * Removes or escapes characters that could cause display or downstream issues.
 * This is defense-in-depth — React JSX + CSP already prevent HTML injection.
 */
export function sanitizeDisplayName(name: string): string {
  if (!name) return "";
  // Replace control characters (except tab, newline, carriage return)
  return name.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
```

**步骤 2:** 在 `MentionsAutocomplete.tsx` 中应用消毒

```tsx
import { sanitizeDisplayName } from "../../security/validation";

// 在 filter 阶段和渲染阶段应用：
items = suggestions
  .filter((s) => sanitizeDisplayName(s).toLowerCase().includes(trimmed))
  .slice(0, 10);

// 渲染时：
<span>{sanitizeDisplayName(item)}</span>

// 选择时（传递给 onPick 的仍然是原始路径，让上游决定是否消毒）：
onPick(items[selectedIdx])
```

**步骤 3:** 添加上游消毒（在 `App.tsx` 的 `handleMentionPick` 中）

```typescript
const handleMentionPick = (value: string) => {
  const sanitized = sanitizeDisplayName(value);
  // 插入到输入框
};
```

### 2.3 测试

- 在 `test/unit/security.test.ts` 添加 3 个测试：
  - 正常路径不变
  - 含控制字符的路径 → 控制字符被移除
  - 空/null 输入 → 返回空字符串

| 文件 | 新增行 | 类型 |
|------|--------|------|
| `src/security/validation.ts` | ~5 行 | 新增函数 |
| `src/ui/MentionsAutocomplete.tsx` | ~2 行 | 导入 + 应用 |
| `test/unit/security.test.ts` | ~15 行 | 单元测试 |

---

## 3. KI-006: 终端集成 Shell 兼容性 (Medium)

### 3.1 问题分析

PiTerminal 使用 `vscode.window.createTerminal()` + `sendText()` 将 bash 工具输出转发到终端。核心 API 在所有 shell 上都能工作。

VS Code Shell Integration API 仅支持 zsh 和 PowerShell——但当前实现**未使用** Shell Integration API，所以这不是限制。

**实际问题是：**
1. PiTerminal 在非标准 shell 上可能无法正确检测命令输出边界
2. 没有反馈告诉用户哪些功能因 shell 限制不可用
3. 当 `enableTerminalIntegration` 启用但 shell 不支持时，用户可能困惑

### 3.2 实现方案

**步骤 1:** 添加 shell 检测函数

在 `src/terminal/PiTerminal.ts` 中添加：

```typescript
import * as os from "os";

/** Detect the current shell used by VS Code terminal integration. */
function detectShell(): string {
  // VS Code reads SHELL env var, or defaults to system shell
  const shell = process.env.SHELL || "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  if (shell.includes("fish")) return "fish";
  if (shell.includes("powershell") || shell.includes("pwsh")) return "powershell";
  return shell || "unknown";
}

/** Returns true if shell integration is available for the detected shell. */
function isShellIntegrationAvailable(shell: string): boolean {
  return shell === "zsh" || shell === "powershell";
}
```

**步骤 2:** 在 PiTerminal 构造函数中添加日志和状态消息

```typescript
constructor(...) {
  const shell = detectShell();
  if (!isShellIntegrationAvailable(shell)) {
    ctx.log("info", `PiTerminal: shell integration not available for "${shell}". Use zsh (macOS/Linux) or PowerShell (Windows) for full terminal output.`);
  }
  // ... existing code
}
```

**步骤 3:** 可选 — 在终端打开时显示 shell 信息

```typescript
show(): void {
  if (!this.terminal) {
    const shell = detectShell();
    this.terminal = vscode.window.createTerminal({
      name: "Pi",
      cwd: this.ctx.config.cwd(),
    });
    // Show shell integration status
    if (!isShellIntegrationAvailable(shell)) {
      this.terminal.sendText(`# Pi Terminal — shell "${shell}" may not support full terminal integration. See docs for details.\n`);
    }
    this.terminal.sendText(`${this.ctx.config.executable}\n`);
  }
  this.terminal.show();
}
```

### 3.3 测试

集成测试（需要 VS Code API）：在 `test/e2e/suite/` 中验证
- 单元测试：检测函数可以直接在 Mocha 中测试（设置 `process.env.SHELL`）

| 文件 | 新增行 | 类型 |
|------|--------|------|
| `src/terminal/PiTerminal.ts` | ~20 行 | 新增检测函数 + 日志 |

---

## 4. KI-008: 高级 CLI 功能未在面板中暴露 (Low)

### 4.1 问题分析

当前 `SlashCommandMenu.tsx` 注册了 22 个斜杠命令。但仍缺少 `pi` CLI 中的若干功能：

| 缺失命令 | pi CLI 等效 | 说明 |
|----------|-------------|------|
| `/install` | `pi install <source>` | 安装扩展 |
| `/remove` | `pi remove <source>` | 移除扩展 |
| `/update` | `pi update` | 更新 pi 自身或扩展 |
| `/list` | `pi list` | 列出已安装扩展 |
| `/config` | `pi config` | 打开配置 TUI |

### 4.2 实现方案

在 `COMMANDS` 数组中追加命令：

```typescript
{ cmd: "/install", desc: "Install extension or skill" },
{ cmd: "/remove", desc: "Remove an installed extension" },
{ cmd: "/update", desc: "Update pi or extensions" },
{ cmd: "/list", desc: "List installed extensions and skills" },
```

这些命令和已有命令一样，会被发送到 `PiRpcClient` 的 `prompt(message)` 方法，pi CLI 会处理它们。不需要在扩展层额外处理。

### 4.3 测试

- 无新测试需要 — 命令的 UI 层逻辑（过滤、显示、选择）已被 `SlashCommandMenu` 的现有逻辑覆盖
- 可以在集成测试中验证新命令的文本出现在过滤结果中

| 文件 | 新增行 | 类型 |
|------|--------|------|
| `src/ui/SlashCommandMenu.tsx` | ~5 行 | 数组追加 |

---

## 5. 工作量汇总

| Issue | 文件变更 | 新增行 | 测试覆盖 | 复杂度 |
|-------|----------|--------|----------|--------|
| KI-001 | `validation.ts`, `MentionsAutocomplete.tsx`, `App.tsx` | ~22 行 | ✅ 3 单元测试 | 简单 |
| KI-006 | `PiTerminal.ts` | ~20 行 | ❌ 需要 VS Code API | 简单 |
| KI-008 | `SlashCommandMenu.tsx` | ~5 行 | 无（已有覆盖） | 简单 |
| **总计** | **5 文件** | **~47 行** | **3 新测试** | **全部简单** |

---

## 6. 验证

```bash
# 单元测试（含新的消毒函数测试）
npm run test:unit

# 集成测试
npm run test:integration

# 全量测试
npm run test

# 编译检查
npm run compile
```
