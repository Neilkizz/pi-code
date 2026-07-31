# Pi Desktop 代码瘦身、缺陷修复与 UI/UX 深度重构规范 (Spec)

> 创建日期：2026-07-31  
> 目标分支：`improvement-v4`  
> 规范定位：Pi Desktop 独立桌面应用清理瘦身、核心安全与逻辑缺陷修复、Claude/ChatGPT 级桌面 UI/UX 深度重构的技术规范。

---

## 1. 概述与背景

Pi Desktop 已成功转型为基于 Tauri + React + Node Host 的独立桌面应用。原仓库中残留的 VS Code 插件代码、过期计划文档及临时文件造成了工程体积膨胀和代码维护混乱。同时，先前的代码审查揭示了命令风险分类、审计日志开销、环境变量隔离及缓存刷新等维度的已知缺陷。

本规范确立了“彻底清理历史包袱、移植并强化核心安全机制、精心打造桌面级 UI/UX 体验”的整体改造路线。

---

## 2. 工程清理与目录瘦身方案 (Engineering Cleanup)

### 2.1 物理删除遗留代码与配置
- **VS Code 扩展相关代码**：
  - 删除 `/src/` 目录下全部针对 VS Code Extension API 的实现（如 `extension.ts` 等）。
  - 删除 `/webview/` 目录及 `webview.webpack.config.js`。
  - 删除根目录下的 `.vscodeignore` 和历史构建产物 `pi-code-0.2.0.vsix`。
- **过期计划与废弃文档**：
  - 清理 `docs/superpowers/plans/` 下所有旧版计划草案（包含 `2026-07-29-pi-code-improvement-plan-v4.md`、`v3.md`、`revised.md` 及原始版本）。
  - 清理 `docs/` 下的中间实施计划：`plan-a3-rpc-integration-test.md`、`plan-a4-e2e-framework.md`、`plan-a5-medium-low-issues.md`。
- **构建配置瘦身**：
  - 更新根目录 `package.json`，移除 `vscode` engine 和 `vscode` 依赖，将构建脚本统一步伐至桌面端：
    - `npm run desktop:dev` -> 启动桌面前端与 Host 联调
    - `npm run desktop:build` -> 构建独立桌面应用
    - `npm run test` -> 运行统一单元与集成测试

### 2.2 规范与核心文档保留清单
- 保留 `TECH_DESIGN.md`、`SECURITY.md`、`docs/pi-desktop-formal-delivery-plan-v3.md`、`docs/pi-desktop-implementation-status.md`。
- 本 Spec 替代所有历史改进草案，作为最新且唯一的审查与改进规范。

---

## 3. 核心缺陷修复与安全增强 (Bug Fixes & Security)

### 3.1 命令风险分类与权限模型 (CommandClassifier)
- **需求**：将原 `CommandClassifier` 与 `PermissionMode` 整合至 `packages/pi-agent-host`。
- **逻辑**：对所有通过 Host 执行的 Bash/Terminal 命令进行实时风险分类（`safe` | `read-only` | `mutation` | `destructive` | `forbidden`）。破坏性命令（如 `rm -rf /`）必须在 Host 层拦截或触发用户二次确认。

### 3.2 AuditLog 轮询与翻转优化 (AuditLog Optimization)
- **需求**：消除背景轮询线程造成的 CPU 开销。
- **逻辑**：移除 `AuditLog` 构造函数中的 `setInterval(() => this.checkRotation(), 30_000)` 后台轮询。仅在 `record()` 触发同步写入时做精准日志大小检查与翻转。

### 3.3 环境变量隔离防护 (Env Inheritance Control)
- **需求**：防止敏感环境变量泄露。
- **逻辑**：所有从桌面 Host 派生的 Git 操作、终端与子进程执行，必须严格通过 `EnvInheritance.filterEnv()` 进行环境变量过滤，禁止隐式透传父进程敏感 Secret/Token。

### 3.4 缓存实时同步与 Watcher 修复 (File Suggestions Cache)
- **需求**：保证文件联想建议与真实文件系统完全实时一致。
- **逻辑**：修复文件监听器（`FileSystemWatcher`）回调流程。当文件创建、删除或重命名时，在调用 `invalidateFileSuggestionsCache()` 后，立即同步调用 `pushFileSuggestions()` 刷新推送至 UI 层。

---

## 4. 桌面端 UI/UX 深度重构 (Desktop UI/UX Design)

### 4.1 总体架构与布局 (Layout Architecture)
采用现代桌面 Agent 应用标准的三栏 responsive 布局：

```
+-----------------------------------------------------------------------------------+
|  Pi Desktop Header Bar (App Title | Model Selector | Workspace | Settings Gear)   |
+-------------------+---------------------------------------+-----------------------+
|                   |                                       |                       |
|  Sidebar (200px)  |  Chat Main Area                       |  Inspector Pane       |
|  - New Session    |  - Message Timeline (Markdown + GFM)  |  - Change Tracker/Diff|
|  - Recent Sessions|  - Tool Call Execution Cards         |  - Step Progress      |
|  - Workspace Quick|  - Floating Composer (Bottom)         |  - Audit Log Monitor  |
|                   |    - Multi-line Auto-expand           |                       |
|                   |    - @ Mention Autocomplete           |                       |
|                   |    - File Attachment Badges           |                       |
+-------------------+---------------------------------------+-----------------------+
```

1. **Header Bar (顶部状态条)**：
   - 支持拖拽的应用标题栏，内嵌当前 AI 模型选择器、工作区目录指示器及 Settings 按钮。
2. **Sidebar (200px 可折叠侧边栏)**：
   - 包含一键“新建会话”、按时间沉淀的历史会话树、会话搜索与快速切换。
3. **Chat Main Area (中央主对话流)**：
   - 宽度自适应，限制居中最大读写宽度（768px）。
4. **Inspector Pane (右侧检查器)**：
   - 默认可折叠或以 Tab 页展示：包含 Git / 文件修改 Diff 视图、Agent 步骤与 Tool 执行追踪日志。

### 4.2 核心组件与交互细节 (Component Design)

1. **Floating Composer (底部悬浮输入框)**：
   - 悬浮于对话流底部，具备 Glassmorphism 边缘与阴影效果。
   - 输入框支持自动多行扩展（1 ~ 8 行）。
   - 输入 `@` 触发工作区文件智能补全弹窗（`MentionsAutocomplete`）。
   - 快捷键规则：`Enter` 发送消息，`Shift+Enter` 换行。
2. **Message Timeline (消息时间轴)**：
   - Markdown 渲染：集成 `react-markdown` + GFM 语法（表格、Task List、代码高亮）。
   - 代码块提供“一键复制”和“全屏预览”操作。
   - 工具调用卡片（Tool Event Cards）：以折叠卡片呈现工具输入参数与输出日志，具备动效 Pulse 加载状态。
3. **Theme & Visual Aesthetics (主题与视觉设计)**：
   - 支持跟随时系统浅色/深色主题，支持减少动效 (Reduced Motion) 与高对比度视觉增强。

---

## 5. 质量校验与验收标准 (Quality Gates)

1. **自动化测试覆盖**：
   - `packages/pi-agent-host` 单元测试通过率 100%。
   - `apps/desktop` 单元与集成测试通过率 100%。
2. **静态代码校验与类型安全**：
   - 移除全部针对 VS Code API 的遗留引用与未使用的工具函数。
   - `tsc --noEmit` 无任何类型错误。
   - `prettier --check` 格式检验通过。
3. **功能与交互体验验收**：
   - 应用独立启动正常，多会话切换流畅。
   - 工具调用风险拦截与审计日志记入符合标准。
   - 桌面 UI/UX 在不同主题及窗口尺寸下无布局错位与渲染卡顿。
