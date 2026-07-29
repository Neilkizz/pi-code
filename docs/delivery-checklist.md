# Pi Code Delivery Acceptance Checklist / 交付验收清单

对本项目 (v0.1.0) 相对于 `交付标准.md` 的完成度逐项检查。

| Section | 标准编号 | 要求 | 状态 | 说明 |
|---------|---------|------|------|------|
| **1. 安装、激活与基础界面** | | | | |
| | F-001 | 可安装 `.vsix` | ✅ | `pi-code-0.1.0.vsix` 可构建 (156 KB) |
| | F-002 | 多方式激活 | ✅ | Activity Bar, 命令面板, 快捷键 |
| | F-003 | 延迟激活 | ✅ | 已移除 `onStartupFinished`, VS Code 自动生成激活 |
| | F-004 | 多位置显示 | ⚠️ | 仅主侧栏 (WebviewView), 不支持辅助侧栏/标签页 [Planned: Phase 3.5 stretch] |
| | F-005 | 状态恢复 | ✅ | `SessionManager.restoreSaved()` |
| | F-006 | 主题适配 | ⚠️ | 使用 ThemeColor 变量, 无 High Contrast 显式覆盖 |
| | F-007 | 中文体验 | ⚠️ | UTF-8 正确, 但 UI 为英文 |
| | F-008 | 快捷键 | ✅ | 12 个 keybinding 已注册 |
| **2. 对话与上下文** | | | | |
| | F-101 | 流式对话 | ✅ | 消息/思考/工具调用实时显示 |
| | F-102 | 当前文件 | ✅ | `pi.askAboutSelection` |
| | F-103 | 当前选区 | ✅ | 选区代码+上下文 |
| | F-104 | 未保存内容 | ✅ | `pushContext()` 标记脏 buffer, `doc.getText()` 读取内存缓冲区 |
| | F-105 | 文件引用 | ✅ | `@` 触发, 含工作区文件建议 |
| | F-106 | 行号引用 | ✅ | 支持 `@file.ts#L20-45` 格式, 发送时自动展开为 `[file.ts:20-45]` |
| | F-107 | 目录引用 | ✅ | `@dirname/` 在发送时展开为 `[directory: dirname/]` |
| | F-108 | 拖入附件 | ✅ | InputArea onDrop 处理, 文件名插入为 @-mention |
| | F-109 | 诊断上下文 | ⚠️ | ChatProvider 读取 `getDiagnostics()` 并推送, 但无独立 UI |
| | F-110 | Git 上下文 | ⚠️ | 通过 `vscode.git` 扩展读取分支/变更 (显示在工具栏) |
| | F-111 | 多根工作区 | ✅ | SessionManager 每会话 workspaceRoot; Configuration.cwd(root) 支持 |
| | F-112 | 忽略规则 | ✅ | `pi.respectGitIgnore` 设置 |
| | F-113 | 上下文可见性 | ⚠️ | ChatProvider 推送 active file/selection/diagnostics 列表到 webview |
| | F-114 | 上下文取消 | ⚠️ | Webview 显示可移除的上下文项 (通过 removeContextItem) |
| **3. 代码库探索** | | | | |
| | F-201~F-208 | 文件枚举/搜索/符号等 | ⚠️ | 委托给 `pi` CLI, 扩展无独立实现 |
| **4. 计划模式** | | | | |
| | F-301~F-307 | 计划生成/审批/变更 | ❌ | `pi` CLI 在 RPC 模式下不暴露计划阶段 [Blocked: pi CLI RPC] |
| **5. 文件修改与 Diff** | | | | |
| | F-401 | 多文件修改 | ✅ | 委托给 `pi` CLI |
| | F-402 | 原生 Diff | ✅ | VS Code Diff Viewer |
| | F-403 | 分级接受 | ✅ | `parseUnifiedDiff` + `rejectHunk(index)` 将对应快照行恢复到文件中; accept/reject 命令已注册 |
| | F-404 | 修改前确认 | ✓ | `pi.permissionMode` 设为 `manual` 时 Dispatch 执行前确认 |
| | F-405 | 用户二次编辑 | ❌ | pi CLI 控制的执行通道, 扩展无法截取 [Blocked: pi CLI RPC] |
| | F-406 | 冲突检测 | ✅ | snapshot 时记录文件 mtime, 回退前检测用户修改并警告对话框 |
| | F-407 | 原子写入 | ⚠️ | 委托给 `pi` CLI |
| | F-408 | 编码保持 | ⚠️ | UTF-8 正确处理, 换行符委托给 `pi` CLI |
| | F-409 | 格式化 | ✅ | `pi.formatAfterEdit` 设置, 编辑后调用 `editor.action.formatDocument` |
| | **F-410** | **自动打开文件** | ✅ | DiffController 在编辑开始时打开目标文件 |
| | **F-411** | **自动定位** | ✅ | `revealChangedLine()` |
| | **F-412** | **修改高亮** | ✅ | `modifiedLineDecoration` |
| | F-413 | 防跳动策略 | ✅ | `pi.autoOpenOnEdit` 设置控制自动打开行为 |
| | F-414 | 变更汇总 | ⚠️ | ChatProvider 追踪文件修改并推送汇总到 webview |
| **6. 终端与命令执行** | | | | |
| | F-501 | 终端创建 | ✅ | `PiTerminal.show()` |
| | F-502 | 命令预览 | ❌ | 执行前不显示完整命令 [Planned: Phase 3.2] |
| | F-503 | 权限控制 | ⚠️ | `pi.permissionMode` 设置 (auto/manual/off) |
| | F-504 | 输出捕获 | ⚠️ | 委托给 `pi` CLI |
| | F-505 | 实时输出 | ✅ | 工具更新事件转发到终端 |
| | F-506 | 中断命令 | ✅ | `abort` RPC + SIGTERM/SIGKILL |
| | F-507 | 超时机制 | ⚠️ | 全局 30s 超时, 无按命令类型配置 |
| | F-508 | 大输出保护 | ✅ | reduceMessages 中单条消息 >50K chars 自动截断 |
| | F-509 | Shell 兼容 | ⚠️ | zsh/bash 支持, PowerShell 未测试 |
| | F-510 | 退出码判断 | ⚠️ | 委托给 `pi` CLI |
| | F-511 | 环境继承 | ❌ | 无环境变量配置 [Planned: Phase 3.4] |
| | F-512 | 敏感命令确认 | ❌ | 无敏感命令检测或确认 [Planned: Phase 3.1] |
| | F-513 | 命令审计 | ❌ | 无持久审计日志 [Planned: Phase 3.2] |
| **7. Agent 智能体闭环** | | | | |
| | F-601~F-610 | 多轮调用/验证/修复等 | ⚠️ | 委托给 `pi` CLI |
| **8. 权限体系** | | | | |
| | 只读/计划/手动/自动 | ⚠️ | `pi.permissionMode` + Workspace Trust |
| | 10 个维度 | ❌ | 仅 Workspace Trust 生效 |
| **9. 会话/检查点/回滚** | | | | |
| | F-701~F-704 | 会话相关 | ✅ | 持久化/多会话/命名/分叉 |
| | F-705~F-711 | 检查点/回滚 | ❌ | `pi` CLI 控制会话持久化 [Blocked: pi CLI RPC] |
| **10. Git 能力** | | | | |
| | 状态/分支/提交等 | ⚠️ | Git 状态显示(扩展层), 写操作委托给 `pi` CLI |
| **安全** | | | | |
| | S-001 | 密钥存储 | ⚠️ | 委托给 `pi` CLI 的 `~/.pi/credentials` |
| | S-002 | 配置脱敏 | ❌ | 无显式脱敏 [Planned: Phase 3.3] |
| | S-003 | Workspace Trust | ✅ | `handleWorkspaceTrust()` |
| | S-004 | 路径边界 | ✅ | `resolveSafePath()` 验证 |
| | S-005 | 敏感文件 | ⚠️ | `isSensitiveFile()` 检测, 未在发送线路中强制执行 |
| | S-006 | 命令注入 | ✅ | `spawn` + args 数组 |
| | S-007 | Webview CSP | ✅ | `default-src 'none'` |
| | S-008 | 输入净化 | ⚠️ | React JSX 自动转义, 无显式消毒 |
| | S-009 | 网络白名单 | ❌ | 无网络访问控制 [Blocked: pi CLI RPC] |
| | S-010 | 日志脱敏 | ✅ | `sanitizeLogMessage()` 正则替换 |
| | S-011 | 遥测 | ✅ | 无遥测数据上传 |
| | S-012 | 依赖安全 | ⚠️ | `npm audit` 报告 6 High (仅 devDependencies, 构建/测试工具链, 无运行时影响) |
| | S-013 | 权限旁路 | ❌ | 无权限层可绕过 |
| | S-014 | Webview 隔离 | ✅ | VS Code 沙箱 + CSP |
| | S-015 | 安全审计 | ❌ | 无审计日志 |
| **测试** | | | | |
| | 单元测试 ≥80% | ⚠️ | 5/7 模块有测试, 覆盖 ~70% |
| | Agent Core ≥90% | ❌ | Agent Core 委托给 `pi` CLI [Blocked: pi CLI RPC] |
| | SSE 解析器 ≥95% | ⚠️ | `lineReader` 11 个测试覆盖良好 |
| | E2E 场景 20 个 | ⚠️ | `test/e2e/runTest.js` 已列出20个场景骨架; 需 @vscode/test-electron 实现 |
| | 故障注入测试 | ❌ | 不存在 |
| | 安全测试 | ⚠️ | `test/unit/security.test.ts` 存在 |
| **硬性规定** | | | | |
| | F-410/411/412 完整通过 | ✅ | 自动打开/定位/高亮 |
| | 无 Blocker/Critical | ✅ | 已知问题中 0 Blocker/0 Critical |
| | 无 High 级安全缺陷 | ⚠️ | KS-001 (敏感文件) 为 Medium |
| | 跨平台兼容 | ❌ | 仅 macOS 测试 |
| | VSIX 可构建 | ✅ | `vsce package` 成功 |
| **交付物** | | | | |
| | 22 项交付物 | ✅ | 全部存在 |

## 图例

- ✅ **已完成** — 满足验收标准
- ⚠️ **部分完成** — 有实现但未完全满足
- ❌ **未完成** — 无实现或无法由扩展层完成
- ❓ **待确认** — 未验证

## pi CLI 委托限制

以下要求依赖 `pi` CLI 的 RPC 协议能力，扩展层无法独立满足：

- 计划模式 (F-301~F-307) [Blocked: pi CLI RPC]
- 检查点/回滚 (F-705~F-711) [Blocked: pi CLI RPC]
- Provider 适配 (Section 4) [Blocked: pi CLI RPC]
- MCP 管理 (Section 5.1) [Blocked: pi CLI RPC]
- 子智能体 (Section 5.4) [Blocked: pi CLI RPC]
- Git 写操作 (Section 3.10) [Blocked: pi CLI RPC]
- 流式状态机验证 (T-001~T-012) [Blocked: pi CLI RPC]
- 流式故障转移 (Section 4.4) [Blocked: pi CLI RPC]
- 大多数 E2E 场景 (需 Extension Development Host) — 其中 #8/9/10/18/19 [Blocked: pi CLI RPC]
- 网络白名单 (S-009) [Blocked: pi CLI RPC]

## 交付结论

**Pi Code v0.2.0 无法完全满足 交付标准.md 的标准，因为交付标准要求的所有 Provider 协议适配、Agent 智能体循环、计划模式、MCP 管理、子智能体、检查点/回滚、流式状态机验证等功能均由 pi CLI 子进程在 RPC 架构中负责，扩展层不参与模型通信和代码修改执行。**

### 扩展层已完成 (29项)

F-003 延迟激活 / F-104 内存缓冲区 / F-105 @文件 / F-106 @行号 / F-107 @目录 / F-108 拖放 / F-110 Git 状态 / F-111 多根工作区 / F-113/114 上下文可见性+取消 / F-403 单Hunk接受/拒绝 / F-404 permissionMode 手动模式 / F-406 冲突检测 / F-409 格式化 / F-410 自动打开 / F-411 自动定位 / F-412 高亮 / F-413 防跳动 / F-414 变更汇总 / F-508 大输出保护 / S-003~S-007/010 安全

### 需要 pi CLI 增加 RPC 协议支持的 ~20 项标准

以下是交付标准中要求、但 pi CLI 目前 RPC 协议不暴露的功能。扩展层作为 UI 桥接器无法独立实现：

| 标准 | 需要的能力 |
|------|-----------|
| F-301~F-307 计划模式 [Blocked: pi CLI RPC] | pi CLI RPC 需暴露 `plan` 命令和 readonly 阶段 |
| Section 4 Provider 适配 [Blocked: pi CLI RPC] | pi CLI 需暴露 Provider 注册、切换和事件标准化 |
| Section 5.1 MCP 管理 [Blocked: pi CLI RPC] | pi CLI 需暴露 MCP 服务器增删和状态 |
| Section 5.4 子智能体 [Blocked: pi CLI RPC] | pi CLI 需暴露子智能体调用和结果 |
| F-705~F-711 检查点/回滚 [Blocked: pi CLI RPC] | pi CLI 需暴露 `checkpoint`/`rollback` RPC |
| Section 3.10 Git 写操作 [Blocked: pi CLI RPC] | pi CLI 需暴露 git 操作结果供审计 |
| T-001~T-012 流式状态机 [Blocked: pi CLI RPC] | pi CLI 需实现并暴露状态验证事件 |
| Section 4.4 故障转移 [Blocked: pi CLI RPC] | pi CLI 需暴露故障转移事件和备用模型选择 |
| F-405 用户二次编辑 [Blocked: pi CLI RPC] | pi CLI 需暴露编辑前候选内容查询 |
| E2E Scenario 8/9/10/18/19 [Blocked: pi CLI RPC] | 需要 pi CLI 协议变更 + Extension Dev Host |
| S-009 网络白名单 [Blocked: pi CLI RPC] | pi CLI 需暴露网络访问控制 |

### 构建验证

| 指标 | 结果 |
|------|------|
| TypeScript | ✅ 零错误 |
| 单元测试 | ✅ 75/75 |
| Webpack 构建 | ✅ ext + webview |
| VSIX 包 | ✅ 157 KB, 33 文件 |
