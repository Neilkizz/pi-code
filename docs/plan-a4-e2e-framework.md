# A4: E2E 测试框架 + 10 个关键场景 — 实施方案

**版本:** 0.2  
**状态:** 方案细化 / 待实施  
**相关文件:** TEST_PLAN.md, 交付标准.md, docs/known-issues.md (KI-003)

---

## 1. 为什么需要 E2E 测试

当前的测试覆盖情况：

| 层级 | 框架 | 测试数 | 状态 |
|------|------|--------|------|
| 单元测试 | Mocha + ts-node | 109 | ✅ |
| 集成测试 | Mocha + Mock RPC Server | 29 | ✅ (A3) |
| E2E 测试 | @vscode/test-electron | 0 | ❌ — 骨架 |

E2E 测试验证的是**在真实 VS Code Extension Development Host 中，扩展能否正确工作**。这是单元测试和集成测试无法覆盖的：

- 扩展激活（activationEvents 是否触发）
- Webview 创建和消息传递
- VS Code API（commands, window, workspace）的完整交互
- Diff Editor、Decoration、CodeLens 等 UI 组件

---

## 2. 技术架构

### 2.1 层次结构

```
test/e2e/
├── runTest.js                  # 启动 VS Code Extension Development Host
├── suite/
│   ├── index.ts               # Mocha 测试入口（在扩展宿主中运行）
│   ├── helpers.ts             # 共享工具函数
│   ├── extension-activation.test.ts
│   ├── webview-creation.test.ts
│   ├── diff-editor.test.ts
│   ├── session-management.test.ts
│   ├── commands.test.ts
│   ├── plan-codelens.test.ts
│   └── permission-dialog.test.ts
├── workspace/                  # 测试工作区
│   ├── .vscode/
│   │   └── settings.json
│   ├── sample.js
│   ├── sample.py
│   └── sample.md
└── fixtures/
    └── mock-pi-response.jsonl  # 模拟 pi 的响应数据
```

### 2.2 运行流程

```
npm run test:e2e
    └─ test/e2e/runTest.js
        └─ @vscode/test-electron 的 runTests()
            ├─ 启动 code --extensionDevelopmentPath=<project>
            │     --extensionTestsPath=<suite/index>
            │     --disable-extensions <workspace>
            └─ VS Code 窗口打开后，自动执行 suite/index.ts
                └─ Mocha runner 执行所有 .test.ts 文件
```

### 2.3 关键类库

| 依赖 | 用途 |
|------|------|
| `@vscode/test-electron` | 管理 VS Code 下载、启动、测试生命周期 |
| `vscode` (运行时) | Extension Development Host 中可直接 `import * as vscode from 'vscode'` |
| `mocha` | 测试框架（与单元测试一致） |
| `assert` | 断言库 |

---

## 3. 实现步骤

### 步骤 1: 搭建测试基础设施

**`test/e2e/runTest.js`** — 替换现有骨架，实现真正的 VS Code 启动：

```javascript
const { runTests } = require('@vscode/test-electron');
const path = require('path');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const testWorkspace = path.resolve(__dirname, './workspace');

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspace,
                '--disable-extensions',  // 减少干扰
            ],
        });
    } catch (err) {
        console.error('E2E tests failed:', err);
        process.exit(1);
    }
}

main();
```

**`test/e2e/suite/index.ts`** — Mocha 入口（在扩展宿主中运行）：

```typescript
import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        timeout: 30000,
        color: true,
    });

    const testDir = __dirname;
    const files = ['extension-activation.test.js', 'webview-creation.test.js', /* ... */];
    
    for (const file of files) {
        mocha.addFile(path.join(testDir, file));
    }

    return new Promise<void>((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) reject(new Error(`${failures} test(s) failed`));
            else resolve();
        });
    });
}
```

注意：测试文件需要用 `.js` 后缀（或在 tsconfig 中额外配置），因为 Mocha 在 VS Code 的上下文中运行，TypeScript 编译需要提前完成。

### 步骤 2: 编译配置

需要在扩展 tsconfig 的 include 中添加测试入口，或使用独立的 tsconfig：

```
// tsconfig.e2e.json
{
  "extends": "./tsconfig.json",
  "include": ["test/e2e/suite/**/*.ts"],
  "compilerOptions": {
    "outDir": "test/e2e/out",
    "rootDir": "test/e2e/suite"
  }
}
```

`runTest.js` 中的 `extensionTestsPath` 指向编译后的 `.js` 文件位置。

### 步骤 3: E2E 测试 Helper

**`test/e2e/suite/helpers.ts`** — 共享工具函数：

```typescript
import * as vscode from 'vscode';
import * as path from 'path';

/** 等待 Webview 面板显示 */
export async function waitForWebview(): Promise<vscode.WebviewPanel> {
    return new Promise((resolve) => {
        const disposable = vscode.window.registerWebviewPanelSerializer('piChat', {
            async deserializeWebviewPanel(panel) {
                disposable.dispose();
                resolve(panel);
            },
        });
    });
}

/** 执行命令并等待扩展激活 */
export async function activateExtension(): Promise<void> {
    await vscode.commands.executeCommand('pi.showChat');
    // 等待异步激活完成
    await new Promise((r) => setTimeout(r, 1000));
}

/** 创建测试文件 */
export function createTestFile(name: string, content: string): vscode.Uri {
    const uri = vscode.Uri.file(path.join(__dirname, '../workspace', name));
    // 通过 VS Code API 写入文件
    return uri;
}
```

### 步骤 4: 10 个 E2E 场景

按复杂度从低到高排列：

| # | 场景 | 文件 | 覆盖 |
|---|------|------|------|
| 1 | 扩展激活 | `extension-activation.test.ts` | `pi.showChat` 命令→扩展激活→commands 注册 |
| 2 | Webview 创建 | `webview-creation.test.ts` | 执行 showChat → WebviewPanel 出现 |
| 3 | 命令注册 | `commands.test.ts` | 验证所有 pi.* 命令已注册 |
| 4 | Webview 消息传递 | `webview-creation.test.ts` | postMessage → 消息到达 ChatProvider |
| 5 | Diff Editor 打开 | `diff-editor.test.ts` | 模拟 tool_execution_end → diff editor 出现 |
| 6 | Diff 接受/拒绝 | `diff-editor.test.ts` | 点击 Accept/Reject → 文件恢复/保留 |
| 7 | 会话管理 | `session-management.test.ts` | newSession / closeSession / 切换 |
| 8 | Plan CodeLens | `plan-codelens.test.ts` | PlanContentProvider 注册 → CodeLens 可见 |
| 9 | 权限对话框 | `permission-dialog.test.ts` | 危险命令→确认对话框 |
| 10 | 装饰（高亮） | `diff-editor.test.ts` | modifiedLineDecoration 在编辑后显示 |

### 步骤 5: 测试工作区

`test/e2e/workspace/` 包含最小化测试文件：

```javascript
// sample.js
function greet(name) {
    return `Hello, ${name}!`;
}
module.exports = { greet };
```

```python
# sample.py
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

### 步骤 6: package.json 更新

```json
"test:e2e": "npm run compile:e2e && node test/e2e/runTest.js",
"compile:e2e": "tsc -p tsconfig.e2e.json"
```

---

## 4. 关键挑战与应对

### 挑战 1: VS Code 测试运行慢

- 每次运行需要启动 VS Code 窗口（5-15 秒）
- **应对**：使用 `--disable-extensions` 减少加载；测试间共享扩展状态

### 挑战 2: 需要 `pi` CLI 可用

- E2E 测试需要 pi CLI 来建立真实 RPC 连接
- **应对**：使用 mock/fake pi 子进程（复用 A3 的 mockRpcServer），或检测 pi 是否安装后跳过

### 挑战 3: TypeScript 编译

- E2E 套件需要预编译才能在扩展宿主中运行
- **应对**：单独的 tsconfig + 编译步骤

### 挑战 4: 测试隔离

- VS Code 的全局状态会跨测试累积
- **应对**：在 beforeEach 中重置状态，或每个测试使用独立 workspace

---

## 5. 估计工作量

| 步骤 | 文件 | 估计时间 |
|------|------|----------|
| 基础框架 (runTest.js + index.ts) | 2 文件 | ~60 行 |
| 编译配置 (tsconfig.e2e.json) | 1 文件 | ~12 行 |
| 测试工作区 | 4 文件 | ~30 行 |
| Helper 函数 | 1 文件 | ~50 行 |
| 场景 1-3：激活 + Webview + 命令 | 3 文件 | ~120 行 |
| 场景 4-6：消息 + Diff | 2 文件 | ~100 行 |
| 场景 7-10：会话 + CodeLens + 权限 | 3 文件 | ~100 行 |
| package.json 更新 | 1 文件 | 3 行 |
| **总计** | **~17 文件** | **~475 行** |

---

## 6. 验证

```bash
# 常规 E2E 测试（需要 VS Code）
npm run test:e2e

# 运行所有测试
npm run test

# 单测 + 集成（快速反馈）
npm run test:unit && npm run test:integration
```

---

## 7. 后续优化

- CI 集成：在 GitHub Actions 中使用 `xvfb-run` 运行无头 VS Code
- 并行测试：多 VS Code 实例同时运行不同场景
- 截图对比：捕捉测试失败时的 UI 截图
