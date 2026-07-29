# Pi Code — Known Issues / 已知问题清单

**Version:** 1.0  
**Status:** Final  
**Last updated:** 2026-07-27  

**Legend / 图例：**

- **Blocker** — Prevents use of a feature entirely / 完全阻止功能使用
- **Critical** — Major feature broken, no acceptable workaround / 主要功能异常，无可用替代方案
- **High** — Feature partially broken, impacts user experience / 功能部分异常，影响用户体验
- **Medium** — Non-critical issue, can be worked around / 非关键问题，可临时绕过
- **Low** — Cosmetic or minor inconvenience / 外观或轻微不便

---

## 1. Security Issues / 安全问题

### KI-001: @-mentions Content Sanitization (Medium)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Medium |
| **Status / 状态** | Open |
| **Component / 模块** | Webview UI (`src/ui/App.tsx`) |
| **Reported / 报告时间** | 2026-07-27 (Review Report) |

**Description / 描述：**
The @-mention autocomplete in the chat input displays file paths and symbol names retrieved from the workspace. While the content is rendered via React JSX (which auto-escapes HTML entities) and a strict Content Security Policy (CSP) is in place, there is no explicit sanitization step for file paths or symbol names that could contain special characters.

聊天输入框中的 @-mention 自动补全功能显示从工作区获取的文件路径和符号名称。虽然内容通过 React JSX 渲染（自动转义 HTML 实体）并配置了严格的 CSP，但对于可能包含特殊字符的文件路径或符号名称，没有进行明确的消毒步骤。

**Impact / 影响：**

- Low in practice due to React JSX + CSP protection
- Medium if a file or symbol name contains content that could be misinterpreted by downstream processing
- 实际上风险较低（React JSX + CSP 保护）
- 如果文件或符号名称包含可能被下游处理误解的内容，则为中等

**Workaround / 临时方案：**

- No user-facing workaround required for current risk level
- The review team confirmed this is a medium-term enhancement, not a blocking defect
- 当前风险水平下无需用户可见的替代方案
- 评审团队确认这是中期改进，不是阻断性缺陷

---

## 2. Testing Gaps / 测试缺口

### KI-002: RPC Integration Test Framework Not Built (High)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | High |
| **Status / 状态** | Open |
| **Component / 模块** | RPC (`src/rpc/`) |
| **Reported / 报告时间** | 2026-07-27 (Review Report) |

**Description / 描述：**
There is no integration test framework for testing the JSONL RPC protocol. Unit tests exist for the `LineReader` and `reduceMessages` modules, but end-to-end RPC protocol tests (request/response matching, event stream parsing, connection lifecycle) are missing.

缺少用于测试 JSONL RPC 协议的集成测试框架。虽然 `LineReader` 和 `reduceMessages` 模块有单元测试，但端到端的 RPC 协议测试（请求/响应匹配、事件流解析、连接生命周期）尚未实现。

**Impact / 影响：**

- Risk of regressions in RPC protocol handling
- Manual testing required for RPC changes
- Cannot automatically verify flow state machine requirements (T-001 through T-012)
- RPC 协议处理存在回归风险
- RPC 变更需要手动测试
- 无法自动验证流式状态机要求（T-001 至 T-012）

**Workaround / 临时方案：**

- Manual smoke testing via `npm run smoke:rpc` (uses actual `pi` CLI)
- Unit tests cover individual components (LineReader, reduceMessages, RequestQueue)
- Code review required for all RPC changes
- 通过 `npm run smoke:rpc` 进行手动冒烟测试（使用实际的 `pi` CLI）
- 单元测试覆盖各个组件（LineReader、reduceMessages、RequestQueue）
- 所有 RPC 变更需要代码审查

### KI-003: E2E Tests Not Yet Implemented (High)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | High |
| **Status / 状态** | Open |
| **Component / 模块** | Test infrastructure (`test/e2e/runTest.js`) |
| **Reported / 报告时间** | 2026-07-27 (Project audit) |

**Description / 描述：**
The end-to-end test runner at `test/e2e/runTest.js` currently exits with "not yet implemented" (exit code 0). No E2E tests exist for the 20 critical scenarios defined in the delivery standards (Section 9.2). This includes tests for auto-open-and-navigate, multi-file edits, permission dialogs, and session recovery.

`test/e2e/runTest.js` 中的端到端测试运行器当前以"not yet implemented"退出（退出码 0）。交付标准（第 9.2 节）定义的 20 个关键场景没有对应的 E2E 测试。这包括自动打开定位、多文件编辑、权限对话框和会话恢复等测试。

```javascript
// test/e2e/runTest.js
console.log("E2E tests not yet implemented (see test/e2e/ directory)");
process.exit(0);
```

**Impact / 影响：**

- Cannot automatically verify critical user workflows
- Cannot run regression tests before releases
- Higher risk of undetected regressions across extension versions
- Blocking many E2E scenarios from the delivery standards
- 无法自动验证关键用户工作流
- 无法在发布前运行回归测试
- 跨扩展版本存在更高的未检测回归风险
- 阻碍交付标准中的多个 E2E 场景

**Workaround / 临时方案：**

- Manual testing of all critical workflows before each release
- Unit and integration tests cover individual components
- RPC smoke test (`npm run smoke:rpc`) provides partial protocol verification
- 每次发布前对所有关键工作流进行手动测试
- 单元测试和集成测试覆盖各个组件
- RPC 冒烟测试（`npm run smoke:rpc`）提供部分协议验证

### KI-004: Unit Test Coverage Below 80% Target (Medium)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Medium |
| **Status / 状态** | Improved — 75 tests covering 5 modules |
| **Component / 模块** | Test infrastructure (unit tests) |
| **Reported / 时间** | 2026-07-27 (Review Report) |

**Description / 描述：**
Current unit test coverage is approximately 70%, below the 80% overall target (and the 90/95% branch coverage targets for Agent Core and permission modules, respectively). Missing tests for `PiRpcClient` lifecycle, `SessionManager`, `ChatProvider` dispatch, `DiffController`, `AuthService`, and `PiTerminal`.

当前单元测试覆盖率约为 70%，低于 80% 的总体目标（以及 Agent Core 的 90% 分支覆盖率和权限模块的 95% 分支覆盖率目标）。缺少对 `PiRpcClient` 生命周期、`SessionManager`、`ChatProvider` 调度、`DiffController`、`AuthService` 和 `PiTerminal` 的测试。

**Impact / 影响：**

- Increased risk of regressions in untested modules
- Cannot measure true code quality across the codebase
- 未测试模块存在回归风险
- 无法衡量整个代码库的真实代码质量

**Workaround / 临时方案：**

- Focus testing effort on `PiRpcClient` and `SessionManager` (P0 priority per TEST_PLAN.md)
- Manual testing for uncovered modules during feature development
- 将测试工作集中在 `PiRpcClient` 和 `SessionManager`（根据 TEST_PLAN.md 的 P0 优先级）
- 在功能开发期间对未覆盖模块进行手动测试

---

## 3. Architecture / 架构

### KI-005: No Built-in MCP Server (Low)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Low |
| **Status / 状态** | By design |
| **Component / 模块** | Architecture / 架构 |
| **Reported / 报告时间** | 2026-07-27 (Project audit) |

**Description / 描述：**
Pi Code does not include a built-in MCP (Model Context Protocol) server. MCP server functionality is delegated to the `pi` CLI, which handles the MCP protocol directly. This means MCP tools are available to the agent when running via CLI, but cannot be independently configured or managed within the VS Code extension UI.

Pi Code 不包含内置的 MCP（模型上下文协议）服务器。MCP 服务器功能委托给 `pi` CLI，由 CLI 直接处理 MCP 协议。这意味着通过 CLI 运行时 MCP 工具对 Agent 可用，但无法在 VS Code 扩展 UI 中独立配置或管理。

**Impact / 影响：**

- Users cannot add custom MCP servers through the extension UI
- MCP server configuration must be done via `pi` CLI configuration
- 用户无法通过扩展 UI 添加自定义 MCP 服务器
- MCP 服务器配置必须通过 `pi` CLI 配置完成

**Workaround / 临时方案：**

- Configure MCP servers via `pi` CLI's own configuration mechanism
- Future enhancement: expose MCP server management in the extension settings
- 通过 `pi` CLI 自身的配置机制配置 MCP 服务器
- 未来改进：在扩展设置中展示 MCP 服务器管理

---

## 4. Feature Gaps / 功能缺口

### KI-006: Terminal Integration Requires a Supported Shell (Medium)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Medium |
| **Status / 状态** | **Resolved** — shell detection warning added in v0.2.1 |
| **Component / 模块** | Terminal (`src/terminal/PiTerminal.ts`) |
| **Reported / 报告时间** | 2026-07-27 (Review Report) |

**Description / 描述：**
The terminal integration feature (`pi.enableTerminalIntegration`) forwards bash tool output to a dedicated VS Code terminal. This requires VS Code's shell integration API, which is only available in zsh (macOS/Linux) and PowerShell (Windows). Users with non-default shells (fish, custom bash configurations) may experience incomplete functionality.

终端集成功能（`pi.enableTerminalIntegration`）将 bash 工具输出转发到专用的 VS Code 终端。这需要 VS Code 的 shell 集成 API，该 API 仅在 zsh（macOS/Linux）和 PowerShell（Windows）中可用。使用非默认 shell（fish、自定义 bash 配置）的用户可能体验不完整的功能。

**Impact / 影响：**

- Feature is off by default (`false`)
- Users on supported shells see full terminal forwarding
- Users on unsupported shells see no terminal output — agent still works, just without the dedicated terminal view
- 该功能默认关闭（`false`）
- 使用受支持 shell 的用户可以看到完整的终端转发
- 使用不受支持的 shell 的用户看不到终端输出——Agent 仍然有效，只是没有专用终端视图

**Workaround / 临时方案：**

- Switch to a supported shell (zsh on macOS/Linux, PowerShell on Windows)
- Disable `pi.enableTerminalIntegration` to avoid confusion
- 切换到受支持的 shell（macOS/Linux 使用 zsh，Windows 使用 PowerShell）
- 禁用 `pi.enableTerminalIntegration` 以避免混淆

---

### KI-009: Virtual Scrolling Not Implemented (Low)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Low |
| **Status / 状态** | Open — deferred to v0.3.0 |
| **Component / 模块** | Webview UI (`src/ui/AppState.ts`) |
| **Reported / 报告时间** | 2026-07-29 (Static analysis) |

**Description / 描述：**
The chat message list uses static rendering with truncation limits: maximum 200 messages, 50,000 characters per message (text and thinkingText). Static analysis estimates ~10MB text payload (200 × 50KB) and ~10,000 DOM nodes (~2MB footprint), totaling ~10-15MB render cost. Virtual scrolling is not implemented.

聊天消息列表使用静态渲染和截断限制：最多 200 条消息，每条消息 50,000 字符（text 和 thinkingText）。静态分析估算约 10MB 文本负载（200 × 50KB）和约 10,000 个 DOM 节点（约 2MB 占用），总计约 10-15MB 渲染开销。未实现虚拟滚动。

**Impact / 影响：**

- Acceptable for typical sessions (<200 messages)
- May cause sluggish rendering on low-end devices when session approaches 200 messages
- No functional degradation — truncation prevents unbounded growth
- 对于典型会话（<200 条消息）可接受
- 当会话接近 200 条消息时，可能在低端设备上导致渲染缓慢
- 无功能降级——截断防止无限制增长

**Workaround / 临时方案：**

- Truncation at 200 messages / 50K chars prevents unbounded memory growth
- Users can fork sessions to start fresh before hitting limits
- Virtual scrolling will be implemented in v0.3.0 for sessions regularly exceeding 200 messages
- 200 条消息/50K 字符的截断防止内存无限制增长
- 用户可以在达到限制前 fork 会话重新开始
- 虚拟滚动将在 v0.3.0 中实现，用于经常超过 200 条消息的会话

### KI-007: Performance on Large Workspaces Varies by Model (Medium)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Medium |
| **Status / 状态** | Open |
| **Component / 模块** | Agent Core (`pi` CLI) |
| **Reported / 报告时间** | 2026-07-27 (Project audit) |

**Description / 描述：**
The performance of code exploration (file search, content search, symbol resolution) on large workspaces (e.g., 10,000+ files) depends heavily on the underlying model's context window and response speed. Larger, slower models may take significantly longer to process search results and plan file modifications. This is inherent to the `pi` CLI's agent loop, not the extension itself.

在大规模工作区（如 10,000+ 文件）上，代码探索（文件搜索、内容搜索、符号解析）的性能在很大程度上取决于底层模型的上下文窗口和响应速度。更大、更慢的模型可能需要显著更长的时间来处理搜索结果和规划文件修改。这是 `pi` CLI Agent 循环的固有特性，而非扩展本身的问题。

**Impact / 影响：**

- Users with smaller-context models may experience degraded agent performance
- Initial file index and search in large repositories can be slow
- Not a defect — a documented limitation of AI agent performance
- 使用较小上下文模型的用户可能会体验到 Agent 性能下降
- 大型仓库中的初始文件索引和搜索可能较慢
- 不是缺陷——这是 AI Agent 性能的已知限制

**Workaround / 临时方案：**

- Use models with larger context windows for large workspaces
- Configure `pi.respectGitIgnore` to exclude unnecessary files
- Manually exclude large directories (node_modules, build, dist) from workspace
- Use targeted @-mention references instead of relying on full workspace search
- 对大型工作区使用具有较大上下文窗口的模型
- 配置 `pi.respectGitIgnore` 以排除不必要的文件
- 手动从工作区中排除大型目录（node_modules、build、dist）
- 使用有针对性的 @-mention 引用，而不是依赖完整工作区搜索

### KI-008: Advanced `pi` CLI Features Not Exposed in Chat Panel (Low)

| Field | Value |
| --- | --- |
| **Severity / 严重性** | Low |
| **Status / 状态** | Open |
| **Component / 模块** | Webview UI, SlashCommandMenu |
| **Reported / 报告时间** | 2026-07-27 (Review Report) |

**Description / 描述：**
Some advanced `pi` CLI features (e.g., custom skills management, detailed session export, advanced provider configuration) are accessible via the terminal but not yet exposed as UI elements or slash commands in the chat panel. The 22 registered slash commands cover the most common operations.

一些高级 `pi` CLI 功能（如自定义技能管理、详细会话导出、高级提供商配置）可通过终端使用，但尚未作为 UI 元素或斜杠命令在聊天面板中展示。已注册的 22 个斜杠命令覆盖了最常见的操作。

**Impact / 影响：**

- Users must open a system terminal to access the full `pi` CLI feature set
- Does not block core workflows
- 用户必须打开系统终端才能访问完整的 `pi` CLI 功能集
- 不影响核心工作流

**Workaround / 临时方案：**

- Open a terminal and use `pi` CLI directly for advanced operations
- Feature can be extended incrementally in future releases
- 打开终端并直接使用 `pi` CLI 进行高级操作
- 该功能可以在未来版本中增量扩展

---

## 5. Previously Resolved Issues (Historical) / 已解决的历史问题

The following issues from the review report were **fully resolved** in v0.1.0 and are no longer active.

以下评审报告中的问题已在 v0.1.0 中**完全解决**，不再活跃。

| ID | Issue / 问题 | Resolution / 解决方案 |
| --- | --- | --- |
| CRITICAL-1 | AuthService `onDidChangeState` listener leak / 监听器泄漏 | Fixed: Proper `dispose` and cleanup / 已修复：正确释放和清理 |
| CRITICAL-2 | LineReader flush boundary test / LineReader flush 边界测试 | Fixed: 15 tests covering all edge cases / 已修复：15 个测试覆盖所有边缘情况 |
| HIGH-1 | PiRpcClient restart race condition / 重启竞态条件 | Fixed: State machine with alive/fence guard / 已修复：带 alive/fence 守卫的状态机 |
| HIGH-2 | AuthService fire-and-forget session / 无等待会话 | Fixed: Proper async/await with error handling / 已修复：带错误处理的正确 async/await |
| HIGH-3 | XSS vulnerability assessment / XSS 漏洞评估 | **Confirmed false-positive** / **确认为误判** |
| HIGH-4 | thinking/text delta not separated / 推理/文本未分离 | Fixed: Dedicated `thinkingText` field / 已修复：专用 `thinkingText` 字段 |
| HIGH-5 | toolCallId exact matching / toolCallId 精确匹配 | Fixed: Prefixed comparison / 已修复：前缀比较 |
| M2 | DiffController undo marker / DiffController 撤销标记 | Fixed: Clear marker on manual edit / 已修复：手动编辑时清除标记 |
| M3 | onLine swallowed exceptions / onLine 异常静默 | Fixed: try/catch with emit / 已修复：带 emit 的 try/catch |
| M4 | setModel/cycleModel state push / 模型状态推送 | Fixed / 已修复 |
| M5 | cycleModel direction (prev/next) / 切换模型方向 | Fixed / 已修复 |
| M7 | RequestQueue no upper bound / 队列无上限 | Fixed: 1000-item limit / 已修复：1000 项上限 |
| M8 | scheduleRestart infinite retries / 无限重试 | Fixed: Max 5 retries with exponential backoff / 已修复：最多 5 次指数退避重试 |
| L1 | reduceMessages unused sessionId / 未使用的 sessionId | Fixed / 已修复 |

---

## 6. Closed Issues (Non-Defects) / 已关闭的非缺陷问题

| ID | Issue / 问题 | Verdict / 结论 |
| --- | --- | --- |
| KI-HIGH-3 | XSS in webview via malicious file paths / 通过恶意文件路径的 XSS | **False-positive.** React JSX auto-escapes HTML. Strict CSP blocks inline scripts. The review team confirmed this is secure. / **误判。** React JSX 自动转义 HTML。严格的 CSP 阻止内联脚本。评审团队确认这是安全的。 |

---

## 7. Summary / 汇总

| Severity / 严重性 | Active / 活跃 | Resolved / 已解决 | Total / 合计 |
| --- | --- | --- | --- |
| Blocker | 0 | 0 | 0 |
| Critical | 0 | 2 | 2 |
| High | 2 (KI-002, KI-003) | 5 | 7 |
| Medium | 3 (KI-001, KI-004, KI-007) | 3 | 6 |
| Low | 2 (KI-005, KI-008, KI-009) | 1 | 4 |
| **Total** | **7** | **11** | **19** |

**As of v0.2.1:** KI-006 resolved (shell detection warning added). KI-009 documented (virtual scrolling deferred to v0.3.0).

**截至 v0.2.1：** KI-006 已解决（添加 shell 检测警告）。KI-009 已记录（虚拟滚动推迟到 v0.3.0）。

---

## 8. Tracking / 跟踪

Known issues are tracked in the project's GitHub issue tracker:

- [GitHub Issues](https://github.com/earendil-works/pi-code/issues)
- [REVIEW_REPORT.md](/REVIEW_REPORT.md) — Full review report with 23 findings
- [交付标准.md](/交付标准.md) — Delivery standards defining pass/fail criteria
