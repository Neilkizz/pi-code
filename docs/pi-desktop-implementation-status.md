# Pi Desktop 当前实现状态、验证证据与后续计划

> 快照日期：2026-07-30  
> 代码分支：`improvement-v4`  
> 产品形态：独立 macOS Agent App，不依赖 VS Code  
> Agent 内核：`@earendil-works/pi-coding-agent` 0.83.0  
> 当前总体交付基线：[`pi-desktop-formal-delivery-plan-v3.md`](./pi-desktop-formal-delivery-plan-v3.md)  
> 历史对标设计：[`pi-desktop-claude-parity-design-v2.md`](./pi-desktop-claude-parity-design-v2.md)

---

## 1. 当前结论

Pi Desktop 已经从原 VS Code 扩展仓库中建立出一套可独立运行的 Tauri + React + Rust 桌面应用。当前构建可以直接启动内置的 Node、Pi Host 和 Pi-Agent，不依赖 VS Code、外部 Pi CLI 或系统 Node。

本轮新增需求已经形成完整链路：

1. 输入 API Endpoint 和 Key 后自动请求模型列表；
2. 可以在应用内直接浏览 `pi.dev` 官方 Package Catalog；
3. 可以选择官方目录中的扩展，以精确 npm 版本下载到本地隔离区；
4. 扩展安装不会执行 npm lifecycle scripts；
5. 扩展经过源码能力扫描、完整目录哈希和不可变快照后，才允许用户启用；
6. 可以检查和手动升级已安装的 npm 扩展；
7. 可以选择在应用启动时自动升级已安装扩展；
8. 可以检查、下载、预检并切换新的 Pi-Agent Core；
9. 可以选择在应用启动时自动升级 Pi-Agent；
10. 核心更新失败不会覆盖当前可用运行时，旧版应用也不会覆盖较新的托管 Pi-Agent；
11. 新任务输入框在 Host 尚未创建 Session 时仍可编辑，首次发送会按顺序创建 Session 并提交 Prompt；
12. 所有配置统一收敛到一个 Settings 入口，Endpoint、模型、扩展、更新和 Runtime 不再占用顶层导航；
13. UI 支持中文和英文，并在重启后保留语言、主题和新任务 Prompt 草稿；
14. 支持跟随系统、浅色和深色三种外观模式，保留 Reduced Motion/Transparency 回退；
15. 已完成独立的 Pi Desktop macOS 图标，替换原 128 × 128 纯蓝占位图，并生成 1024 × 1024 带透明边缘的生产母版。
16. Send 只有在 Pi Host 返回同一 `messageId` 的成功响应后才算提交成功；创建 Session 失败不会继续发送 Prompt；
17. Prompt 未被 Host 确认时会回滚乐观消息、恢复草稿并保留附件，不再出现空白 Pi 气泡或“已提交”的假成功状态；
18. 托管 npm 扩展会解析 `package.json` 中声明的 `pi.extensions` 精确入口，单个扩展加载失败只停用该扩展，不再阻断 Pi-Agent 核心会话。
19. 已按本机 Claude Desktop 1.24012.9 的实际窗口完成一轮界面基准重构：200 px 可折叠侧栏、单焦点新任务页、窄幅对话列、浮动 Composer、右侧 Progress/Project 检查器和模态 Settings；
20. Timeline 已使用 `react-markdown` + GFM 渲染标题、列表、表格、引用、链接与代码块，不再直接显示 Markdown 原文；
21. 冷启动时 Event Store 只恢复历史与活动，不再把旧 `task.status` 误判为当前 Worker；历史任务会自动重建 Pi Worker 后再允许发送。

当前状态属于“可运行的独立 Engineering Alpha”，不能称为正式交付版本，也尚未完成 ChatGPT Desktop 与 Claude Desktop 的完整桌面对标。V3 审计确认，差距不仅包括高级 Pane、完整 Diff 审查、Preview、Quick Entry、通知、MCP/Connector、签名公证和 Universal 发布，还包括产品信息架构、统一交互语言、Artifact 成品工作流、GUI 自动化测试、辅助功能、性能预算和发布门禁。后续实施与验收统一以 V3 总体交付基线为准。

### V3 Phase 0 实施进度（2026-07-30）

本次已开始执行 V3 的 Foundation 与 Composer 工作流：

1. 新增 Vitest + jsdom 单元测试基座，`npm run test:unit` 已成为桌面端独立回归入口；
2. 新增 `app/routes.ts`，将 `WorkspaceView` 从 Shell 组件中剥离，为后续 Ask/Work/Build 路由扩展建立类型边界；
3. 新增纯函数 `deriveComposerState`，将发送资格、运行时未就绪、任务恢复、Git worktree 校验、空输入和提交中状态统一为可测试状态机；
4. App 层新增提交互斥锁：Pi Host 尚未确认上一条命令前，键盘与按钮均不能重复提交；
5. Composer 已展示“正在提交提示词”状态并禁用附件操作，避免确认窗口中的重复动作；
6. 设计 Token 补充了字号、控件尺寸和间距基线；主窗口最小宽度由 1,080 px 下调至 760 px，Composer 控件不再使用 8.5 px 字号。

验证证据：`npm run test:unit`（4/4 通过）以及 `npm run build`（TypeScript、Protocol 构建与 Vite 生产构建通过）。

尚未完成：App Kernel 拆分、完整 Token 迁移、全量小字号清理、组件测试、Projects/Artifacts/Automations 路由和 GUI E2E。这些仍按 V3 的 FND-001、FND-004、FND-005、UX-001 和 SES-001 排序推进。

### V3 Project Center 实施进度（2026-07-30）

1. 已新增 SQLite `ProjectRepository` 与 `project_list` Tauri Command；项目卡片使用 `projects` 表的权威数据，并统计未归档任务与最近打开时间；
2. Protocol、Tauri bridge 与 React 已新增 `ProjectSummary` 类型，避免 WebView 通过任务数组自行推断项目；
3. 新增真实 `projects` 工作区路由；侧栏 Projects 入口不再错误地跳回 Tasks；
4. Project Center 支持打开已知项目的最近任务、从已有项目创建新任务，以及通过原生文件夹选择器开始新项目任务；
5. 项目首次任务仍由现有 TaskRepository 在同一 SQLite 事务中创建项目记录，避免引入无任务、无权限边界的伪项目。

验证证据：`npm --prefix apps/desktop run test:unit`（4/4 通过）、`npm --prefix apps/desktop run build`（通过）、`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml project_repository::tests::lists_projects_with_active_task_counts_and_recent_first`（通过）和 `cargo fmt --check`（通过）。

### V3 Project Detail 实施进度（2026-07-30）

1. Project Center 已由单纯卡片网格升级为搜索、项目列表和项目详情三段式工作台；
2. 用户可在详情内浏览该项目的任务标题、隔离环境/分支和最近活动，并直接打开历史任务或新建任务；
3. 项目搜索同时覆盖显示名称、根目录和信任状态，过滤函数已加入独立前端单元测试；
4. 窄窗口会自动切换为纵向布局，确保 760 px 最小窗口仍可使用。

验证证据：`npm --prefix apps/desktop run test:unit`（6/6 通过）、`npm --prefix apps/desktop run build`（通过）和 `git diff --check`（通过）。

### V3 Project Instructions 实施进度（2026-07-30）

1. Projects 现已支持项目级指令的可见编辑与保存，长度上限为 32 KiB；指令保存在 SQLite `projects.defaults_json`，不写入 Endpoint 配置或普通日志；
2. 新增 `project_instructions_save` IPC 与 Protocol 类型，保存后更新当前 UI 投影；
3. `task.create` 增加显式可选 `projectInstructions` 字段；新建任务、恢复任务和 Worker 自动恢复均保留该字段；
4. Pi Host 将这些用户可见的项目指令作为 Resource Loader 的系统上下文追加，与项目内 `AGENTS.md`/`CLAUDE.md` 上下文一起加载，不篡改用户提交的 Prompt；
5. SQLite 测试已覆盖项目指令写入后重新读取。

验证证据：`npm --prefix packages/pi-agent-host run check`、`npm --prefix apps/desktop run test:unit`、`npm --prefix apps/desktop run build`、`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml project_repository::tests::lists_projects_with_active_task_counts_and_recent_first`、`cargo fmt --check` 和 `git diff --check` 均通过。

### V3 Recent Task Search 实施进度（2026-07-30）

1. 侧栏 Recents 新增任务搜索；可按任务标题、项目根目录、工作目录和 Worktree 分支过滤；
2. 搜索逻辑提炼为纯函数并有单元测试；无结果时显示明确空态，不把“未匹配”误示为“无任务”；
3. 该搜索只过滤当前 SQLite 已加载的未归档任务，不会改变任务顺序、归档状态或运行时状态。

验证证据：`npm --prefix apps/desktop run test:unit`（7/7 通过）、`npm --prefix apps/desktop run build`（通过）和 `git diff --check`（通过）。

### V3 Conversation Continuity 与可审查轨迹（2026-07-30）

1. Timeline 采用“跟随最新消息 / 保护历史阅读”双态滚动锚点：用户位于底部时，流式 token、工具活动与内容重排会在下一帧合并滚动到最新处；用户上翻后不再强制拉回，并显示独立的“回到最新消息”控件；
2. 取消会参与普通文档流的跳转控件布局，改为覆盖在对话滚动容器上，避免流式消息到达时额外插入或移除块级高度造成抖动；
3. 每次 Tool 调用使用 `toolCallId` 合并开始/结束事件，保留可展开的输入、输出、时间、运行中/完成/失败状态，而不再把一次调用显示为两条无关联的摘要；
4. 消息元信息包含发言者、流式状态和时间；Task 顶栏显式显示工作目录、Worktree 分支、端点、模型和权限模式，不再因 CSS 隐藏关键运行上下文；
5. 右侧 Project Inspector 固定为独立网格轨道：Progress、项目头、Tabs、文件浏览器与 Preview 各自拥有稳定尺寸和内部滚动，避免文件列表/Preview 重绘推动对话区域。
6. 侧栏折叠不再动画化主 Shell 的网格列宽，避免 Markdown 在宽度连续变化时反复换行并造成整页抖动。

验证证据：新增 `Timeline.test.tsx` 覆盖“底部跟随”“上翻不抢滚动”“工具输入输出详情”三条行为；`npm --prefix apps/desktop run test:unit`（10/10 通过）、`npm --prefix apps/desktop run build`（通过）、`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`（通过）和 `git diff --check`（通过）。开发脚本新增 `npm run tauri:dev:isolated`，使用独立的 `com.piagent.desktop.dev` 数据目录，防止旧 `.app` 的用户数据或同 Bundle ID 窗口污染 UI 回归。

### V3 Interactive Diff Review 实施进度（2026-07-31）

1. Workspace Inspector 的 Diff 标签已从只读升级为可交互审查：单个文件按 Hunk 提供 `Revert`（撤销该块）与已撤销块的 `Keep`（重新应用），文件级提供 `Revert file`；未跟踪文件整文件提供 `Keep file` / `Delete file`；
2. 新增 `workspace_diff_apply` Tauri Command：通过 `git apply` / `git apply --reverse` 把前端解析出的单个 Hunk 或整文件 diff 应用到任务工作区，Rust 端只信任前端提交的 Hunk 体并在应用前做路径边界、Symlink 与“差异过期”守卫；
3. 外部修改/冲突检测由 `git apply` 的原子上下文匹配天然提供：文件在审查期间被改动则干净失败并提示刷新；相邻 Hunk 的重新应用失败同样提示刷新，只读视图保留为回退；
4. 未跟踪文件 Revert 前先把文件内容备份到 App Data（`backups/diff-review/<task>/`），`Keep` 可恢复，实现操作可撤销；Keep↔Revert 双向可逆；
5. 每次 Keep/Revert 写入 `audit_log`（actor `user`，action `diff.keep` / `diff.revert`），Security Audit 页可追溯；
6. 全量 diff 的“All changes”聚合视图保持只读（路径未知时不混合同一文件的 Hunk），并提示先选择单个文件；
7. 真实 `.app` GUI smoke 通过（2026-07-31）：重建 Release 应用后在运行中的应用内完成逐 Hunk 交互——中间 Hunk（`file.txt` 第 25 行）`Revert` 后磁盘恢复为 `line25`，且第 2/40 行改动保持不变（Hunk 独立性）；`Keep` 重新应用还原为 `MIDDLE-CHANGED`（双向可逆）；未跟踪文件 `new.txt` 的 `Delete file` 删除磁盘文件并写入备份 `backups/diff-review/<task>/new.txt`、`Keep file` 从备份恢复原始内容；4 次操作均写入 `audit_log`。

验证证据：新增 `workspace::apply` Rust 测试 9 项（单 Hunk 撤销保留其他 Hunk 与无关改动、Keep 重新应用、整文件回退到 HEAD、外部修改拒绝、Symlink/路径穿越/已归档拒绝、未跟踪删除与恢复、审计行写入）全部通过，Rust 全量测试 54/54；新增前端 `parseUnifiedDiff.test.ts` 与 `WorkspaceDiffReview.test.tsx`（Hunk 解析、点击 Revert 调用桥接、聚合视图只读）；`npm --prefix apps/desktop run test:unit`（24/24 通过）、`npm --prefix apps/desktop run build`（通过）、`npm run typecheck`（通过）、`cargo fmt --check`（通过）与 `git diff --check`（通过）。

### V3 Preview / Dev Server v1 实施进度（2026-08-01）

1. 新增 `preview.rs`：基于 `tiny_http` 的隔离本地静态服务，只绑定 `127.0.0.1` 随机端口，根目录为任务 cwd；请求路径百分号解码 + 归一化拒绝 `..`，canonicalize 后校验 `starts_with(root)` 拦截 Symlink 逃逸，目录自动回退 `index.html`，按扩展名推断 MIME；
2. 每次请求经 Tauri `preview-log` 事件流式推送 `method/path/status/mime/bytes` 到 Console；服务启停写入 `audit_log`（`preview.server_start` / `preview.server_stop`）；
3. 新增 `preview_start` / `preview_stop` / `preview_status` / `preview_open` 四个 Tauri Command（`preview_open` 只允许 `http://127.0.0.1:*` / `http://localhost:*` 前缀，防止作为任意 URL 开启器）；
4. 复用 `workspace::task_root`（改为 `pub`）解析任务 root 并拒绝归档任务；`PreviewManager` 按 `TerminalManager` 模式作为 `tauri::State` 管理，窗口销毁时 `stop_all`；
5. `tauri.conf.json` CSP 放宽：`frame-src` / `img-src` / `connect-src` 增加 `http://127.0.0.1:*`，使 iframe/图片/请求可达独立本地 Origin（仅回环地址，跨源 iframe 无法触达 Tauri IPC）；
6. PaneLayout 新增 Preview 底部槽位：独立 `previewHeight`（160–600）行拖拽 resizer、窄屏（<760px）Tab 加入“预览”，`paneLayoutState` 向后兼容加载旧版 `localStorage` 布局；
7. 新增 `PreviewPane` 组件：URL 地址栏、Open in browser、Start/Stop、沙箱 `<iframe sandbox="allow-scripts allow-same-origin allow-forms">` 渲染 HTML/PDF、`<img>` 渲染图片、可清空的 Console 日志视图。

验证证据：新增 `preview` Rust 测试 9 项（HTML 服务、目录 index、`..` 逃逸拒绝、Symlink 逃逸 403、非 GET 405、MIME 推断、start 幂等与 stop 后重启、归档任务拒绝、启停审计行）全部通过，Rust 全量测试 78/78（1 项 live 忽略）；新增前端 `PreviewPane.test.tsx` 6 项与 PaneLayout/paneLayoutState 预览相关测试；`npm --prefix apps/desktop run test:unit`（16 文件 / 69 项通过）、`npm --prefix apps/desktop run build`（通过）、`npm run typecheck`（通过）、`cargo fmt --check`（通过）与 `git diff --check`（通过）。Dev Server 端口审批与子进程捕获留待 NEXT-W01 v2。

真实 `.app` GUI smoke（2026-08-01）：重建并 ad-hoc 签名 Release 应用，种子一个指向含 `index.html`（内联 `<img src="photo.png">`）与 `doc.pdf` 的临时工作区任务后启动；AX 辅助功能树点击工具栏 Preview 复选框打开底部预览面板 → 点击「启动预览」后地址栏显示 `http://127.0.0.1:63517`，截图确认 iframe 实际渲染「Hello Preview」标题与红色 64px 图片（CSP `frame-src`/`img-src` 放行生效）；预览 Console 逐行显示 `GET / 200 text/html; charset=utf-8 361 B` 与 `GET photo.png 200 image/png 70 B`；`curl /doc.pdf` 返回 `200 application/pdf`（596 B）、`curl /%2e%2e/secret.txt` 返回 `400`（路径穿越拦截）、`curl /` 返回 `200 text/html`；点击「停止预览」后端口连接拒绝且 UI 恢复为「启动预览」；退出应用后预览端口关闭（`PreviewManager::stop_all` 无泄漏）。冒烟测试任务与工作区已清理。

### V3 Session Tree / Fork / Compaction v1 实施进度（2026-08-01）

1. 确认 Pi SDK（`@earendil-works/pi-coding-agent` v0.83）已内置完整会话树/压缩/分支引擎：会话 JSONL 文件即 `id/parentId` 树，自动压缩默认开启，`SessionManager.getTree()/getLeafId()/buildSessionContext()` 可用；本轮为桌面侧接线；
2. Protocol：`TaskTranscriptMessage.role` 扩展 `compactionSummary`/`branchSummary` 并新增可选 `label`；新增 `SessionTree`/`SessionTreeEntry`；`DesktopToHostPayload` 加 `task.getTree`，`HostToDesktopPayload` 加 `task.tree`；`ProtocolFeature` 加 `sessions-tree`；
3. Host（`desktop-host.ts`）：`DesktopSessionRuntime` 增加 `sessionManager` 字段；`task.history` 的 `toTranscriptMessages` 放行压缩/分支摘要角色并透传 label（其文本取自 `summary` 字段）；`dispatch` 加 `task.getTree`（sessionWorker 模式直接 emit，worker 模式经 TaskWorkerProxy 转发）；新增 `mapSessionTree`（导出纯函数，展开全树、按 `getLeafId` 沿 parentId 回溯标记 `current`）；
4. 前端：`sessions.tree` Feature Flag（默认关）；`TaskViewState` 加 `tree`/`treeLoading`；`task.history` 到达且 flag 开启时请求 `task.getTree`；`consumePiEvent` 处理 `compaction_start/end` 推送活动；Timeline 内联渲染「上下文已压缩」分隔卡与「在此分叉」分支卡（含 label）；检查器新增只读「会话树」Tab（flag 门控）递归渲染树、当前叶子路径高亮并带「当前」徽标，支持刷新；
5. 回退：`sessions.tree` 关闭即不请求树、不显示会话树 Tab，Timeline 仍正确渲染压缩/分支标记（避免误当 assistant 气泡）。

验证证据：新增 host 纯函数测试 3 项（`toTranscriptMessages` 含摘要角色与 label、附件上下文剥离、`mapSessionTree` 树展开与 current 标记）全部通过，host 全量测试 22/22；新增前端 Timeline 标记测试 1 项与 `SessionTreeView.test.tsx` 4 项；`npm --prefix apps/desktop run test:unit`（17 文件 / 74 项通过）、`npm --prefix apps/desktop run build`（通过）、`npm run typecheck`（通过）、`cargo test`（78 通过，1 项 live 忽略）、`cargo fmt --check` 与 `git diff --check` 通过。交互式 Fork/Compact/Steer 与 `pi_sessions` 表接线留待 v2。

真实 `.app` GUI smoke（2026-08-01）：重建 Release 应用（临时开启 `sessions.tree` 标志）后启动；AX 辅助功能树确认检查器出现第 5 个「会话树」Tab，点击后只读树递归渲染真实会话的全部条目（MODEL_CHANGE / THINKING_LEVEL_CHANGE / 各用户与助手消息），当前叶子路径条目全部带「当前」高亮；「刷新」按钮可用，worker 离线时刷新优雅降级（保留已加载树、清除加载态，不再弹错误横幅）。冒烟中发现并修复两个集成问题：(1) protocol 运行时校验器 `validation.ts` 的命令白名单未含 `task.getTree`（仅改了 TS 类型），导致 host 报 `Unknown message type: task.getTree`——已补 `case "task.getTree"` 并新增 `protocol.test.mjs` 回归测试（有效 UUID 通过、畸形 taskId 拒绝）；(2) `onRequestSessionTree` 失败时曾弹全局错误横幅——改为静默清除 `treeLoading` 保留已加载树。冒烟后恢复 `sessions.tree` 默认关闭并重建，交付应用与提交代码一致。

### V3 Steer / Follow-up Queue 实施进度（2026-08-01）

1. 确认 Pi-Agent SDK 已内置完整跟进队列：`AgentSession.prompt(text, { streamingBehavior: "steer"|"followUp" })` 在运行中会入队（`_queueSteer`/`_queueFollowUp`）并发 `queue_update` 事件，`clearQueue()` 可用；但 Host 的 `TaskRunController.start()` 在 active 时硬抛 `"Task is already running"`，协议 `task.prompt` 无该字段。本轮为控制器+协议+前端接线，不改 SDK；
2. Protocol：`task.prompt` 加可选 `streamingBehavior?: "steer" | "followUp"`；新增 `task.promptQueueClear` 命令；`validation.ts` 校验 `streamingBehavior` 并补白名单（沿用 `task.getTree` 的教训），`protocol.test.mjs` 加回归；
3. Host（`task-run-controller.ts`）：`PromptSession` 加 `clearQueue` 与 `streamingBehavior`；`start()` 在 active 时无 `streamingBehavior` 仍抛（回退），有则透传 SDK 入队（返回 `{ accepted: true, queued: true }`，不触碰 active/generation/status）；`clearQueue()` 与 `abort()` 顺带清队列；`desktop-host.ts` 的 `startPromptTask` 透传 `streamingBehavior`，dispatch 加 `task.promptQueueClear`；
4. 前端：`TaskViewState.queuedPrompts`；`submitFollowUp` 运行中发 `task.prompt { streamingBehavior: "followUp" }` 并入本地队列（不加乐观消息）；`consumePiEvent` 处理 `message_start`（user，去重后追加到 Timeline，顺带修复冷启动重放缺用户气泡）与 `queue_update`（按文本匹配保留未投递项）；Composer 运行中显示「发送跟进」+ Stop 双按钮、队列徽标（数量 + 展开列表 + 「取消全部」）；IME 增加 `compositionstart/end` 跟踪；
5. 崩溃恢复：`queuedPrompts` 持久化到 `pi-desktop.pending-prompt.<taskId>`；`activateRecord` 读取回显徽标；resume（`task.history`）后对未投递项重提 `task.prompt { streamingBehavior: "followUp" }`（尽力而为，`queue_update` 去重）。

验证证据：新增 Protocol 校验测试 2 项、host `task-run-controller` 测试 2 项（active 时无 behavior 仍抛、有则透传入队且不重置 active、`clearQueue`/`abort` 清队列）、前端 `queueState.test.ts` 3 项与 `composerState.test.ts` 跟进模式 1 项；host 全量测试 24/24、`npm --prefix apps/desktop run test:unit`（18 文件 / 80 项通过）、`npm run typecheck`、`npm --prefix apps/desktop run build`、`cargo test`（78 通过，1 项 live 忽略）、`cargo fmt --check` 与 `git diff --check` 全部通过。steer 打断入口与同名文本去重边界留待后续。

真实 `.app` GUI smoke（2026-08-01）：重建 Release 应用后启动并打开已有任务；AX 设置 Composer textarea 值并回车发送一个长分析 prompt，任务进入「运行中」；随后 Composer 切换为跟进模式（「发送跟进」+「停止 Pi」双按钮）；再发送一条跟进后，AX 树确认「跟进已排队」活动与队列徽标「1 条跟进待处理」，跟进消息不进入 Timeline（正确等待当前回合）；点击徽标展开弹层显示跟进内容，点「取消全部」后徽标消失（host `session.clearQueue()` + `queue_update` 生效）；再次排队一条跟进后按「停止 Pi」，任务回到「空闲」、徽标同时清空（Stop 顺带清队列）、Composer 恢复普通「发送提示词」。冒烟期间因该任务 worktree 的 read 工具权限失败，首轮未完成，跟进「按序投递」（当前回合结束后的 message_start 追加）由 SDK 队列排空逻辑与单元测试覆盖。冒烟后退出应用，交付环境干净。

### V3 Notification + Dock Badge 实施进度（2026-08-01）

1. 新增 `tauri-plugin-notification`（macOS 走 notify-rust，无额外签名/entitlement），`lib.rs` 注册插件，`capabilities/default.json` 加 `notification:default`；
2. 新增 `app_notify`（`app.notification().builder().title().body().show()`）与 `app_set_badge`（`app.get_webview_window("main")?.set_badge_count(count)`，底层 `NSApplication.dockTile.setBadgeLabel`，`0`/`None` 清除）两个 Tauri Command；
3. `UpdatePreferences` 加 `notificationsEnabled`（`#[serde(default)]` 向后兼容），`update_preferences_get/save` 命令复用；
4. 前端新增 `notificationState.ts` 纯函数：`computeDockBadge`（等待+失败任务计数）、`detectStatusTransition`（首个状态不算迁移，避免重连误报）；App.tsx `task.status` 分支检测迁移 → 更新 Dock 徽标；开关开启且 `document.visibilityState === "hidden"`（焦点抑制）时发原生通知（title 从任务列表查、回退「Pi 任务」）；bootstrap 时设初始徽标并加载开关；
5. 设置 General 新增「通知」开关卡（`update-toggle` 复选框，绑定 `notificationsEnabled`，保存到 `updates.json`）。

验证证据：新增前端 `notificationState.test.ts` 7 项（徽标计数、各迁移、首个状态不算、非通知态忽略）；`npm --prefix apps/desktop run test:unit`（19 文件 / 87 项通过）、`npm run typecheck`（通过）、`npm --prefix apps/desktop run build`（通过）、`cargo test`（78 通过，1 项 live 忽略）、`cargo fmt --check` 与 `git diff --check` 通过。

真实 `.app` GUI smoke（2026-08-01）：重建 Release 应用（含 notification 插件与 `notification:default` capability）后启动正常，无崩溃；Settings → General 出现「通知」开关（AX 确认复选框），点击后 `updates.json` 持久化为 `notificationsEnabled: true`；后台化运行任务完成时迁移检测路径正常触发（Timeline 显示 OK 完成）。说明：原生通知横幅的实际展示依赖 macOS 对应用的「通知」授权（ad-hoc 未公证应用需用户在 系统设置→通知→Pi Desktop 手动开启），本冒烟环境未授予故横幅未上屏；Dock 徽标数字需任务处于 waiting/failed 边界态（本环境 worker/模型受限无法稳定触发），二者均由 `notificationState` 单元测试与 `app_set_badge`（Tauri 内置 `set_badge_count`）代码接线覆盖。冒烟后退出应用，交付环境干净。

### V3 Quick Entry + Screenshot 实施进度（2026-08-01）

1. 新增 `tauri-plugin-global-shortcut`（Rust 侧 `.setup()` 注册 `CmdOrCtrl+Shift+Space`，无需 capability）与 `core-graphics`（`ScreenCaptureAccess::preflight()` 做 Screen Recording TCC 门控）；
2. `tauri.conf.json` 新增第二个窗口 `label: "quick-entry"`（560×360、centered、alwaysOnTop、skipTaskbar、默认隐藏）；`capabilities/default.json` windows 覆盖 `quick-entry`；
3. 新命令 `attachment_screenshot(task_id)`：preflight 拒绝→返回 `SCREEN_RECORDING_PERMISSION_DENIED`（前端映射 i18n 并降级）；先隐藏 quick-entry 窗口→`spawn_blocking` 调 `/usr/sbin/screencapture -x -o` 整屏捕获→`AttachmentStore::import` 复制/哈希/分类/入库→返回 `TaskAttachment`；
4. 前端 `main.tsx` 按 `getCurrentWindow().label === "quick-entry"` 分支渲染轻量 `QuickEntry.tsx`（prompt 输入 + 截图开关 + 提交，Enter 提交/Esc 隐藏，提交时 emit `quick-entry-submit`）；主窗口 App 监听该事件，`handleQuickEntrySubmit` 复用 `createScratchWorkspace` + 重构后的 `createTask`（支持 `initialPrompt`/`initialAttachments`/`captureScreenshot`），截图在任务创建后导入再随 `task.prompt` 提交，截图失败仍以纯文本提交（优雅降级）；
5. `on_window_event` 增加 `window.label() == "main"` 守卫，quick-entry 窗口关闭不再误停运行时。

验证证据：新增前端 `QuickEntry.test.tsx` 4 项（渲染、空 prompt 禁用提交、emit 负载、截图开关）；`npm --prefix apps/desktop run test:unit`（20 文件 / 91 项通过）、`npm run typecheck`（通过）、`npm --prefix apps/desktop run build`（通过）、`cargo test`（78 通过，1 项 live 忽略）、`cargo fmt --check` 与 `git diff --check` 通过。

真实 `.app` GUI smoke（2026-08-01）：重建 Release 应用后 `CGWindowList` 确认 quick-entry 窗口存在且默认隐藏（560×360）；`Cmd+Shift+Space` 全局快捷键经 `System Events` keystroke 触发后窗口上屏（AX 确认标题「快速发起」/占位符/「截图」开关/「提交」按钮完整渲染；注：CGEvent 合成键事件不触发 Carbon 热键，真实键事件可）；提交后主窗口 AX 树确认隐藏修复生效（quick-entry `onscreen` 消失）、新 scratch 任务创建、prompt 进入 Timeline 且 Composer 转「发送跟进」（任务运行中）；开启「截图」提交时因本环境未授予 Screen Recording 权限，`attachment_screenshot` 返回 `SCREEN_RECORDING_PERMISSION_DENIED` 并优雅降级为纯文本提交（任务无附件）；普通 New Chat 入口不受影响。冒烟中修复 quick-entry 提交后未隐藏问题（新增 `quick_entry_hide` 命令，主窗口 `handleQuickEntrySubmit` 开头调用）。冒烟测试任务与 scratch 目录已清理。

### V3 Extension Contract v1 实施进度（2026-08-02）

1. **契约**：`pi.extensions` manifest 从 `string[]` 扩展为结构化对象数组（兼容两者）——`{ entry, description?, icon?, tools?, commands?, hooks?, renderers?, flags?, shortcuts? }`，`resolveManagedExtensionEntries` 现返回 `{ paths, surface }`（`managed-extension-entries.ts`），worker `ready` 清单携带声明面（hooks/commands/renderers 标注 disabled，`createRestrictedContext` stub 保留，执行仍禁）；
2. **通告**：Rust `extensions.rs` 新增 `ExtensionSurface`/`ExtensionToolInfo`/`ExtensionCommandInfo` 类型，`save()`/npm 安装/`activate_version` 时解析快照内 `package.json` 的 `pi.extensions`（字符串或对象兼容），存入 `ExtensionProfile.surface`（serde default 向后兼容），`extension_list` 返回——桌面即知扩展声明面，无需任务运行；
3. **能力清单**：ExtensionCenter 每个扩展卡片新增「能力」`capability-list` 区块——声明工具（name/label/描述）、命令、钩子、渲染器；非 tool 表面经 `CapabilityGroup--disabled` 标注「执行已禁用」；无声明显示「未声明任何能力」；
4. **友好审批**：新 `extensionToolLabel` 纯函数把 `extension:{id}:{tool}` 映射为声明工具 label/描述；App 启动加载 `extension_list` 得 `extensionProfiles`，经 `resolveToolLabel` 传给 SessionWorkspace→ApprovalShelf，审批弹窗显示友好名而非原始身份串。

验证证据：新增 host `managed-extension-entries.test.mjs` 4 项（legacy 字符串、结构化对象、混合、逃逸拒绝，返回 `{paths, surface}`）、Rust `extensions.rs` 3 项（结构化 surface 解析、legacy 空 surface、缺 manifest 空 surface）、前端 `surface.test.ts` 8 项；host 全量 26/26、`npm --prefix apps/desktop run test:unit`（99 项通过）、`npm run typecheck`、`npm --prefix apps/desktop run build`、`cargo test`（81 通过，1 项 live 忽略）、`cargo fmt --check` 与 `git diff --check` 全部通过。hooks/commands/renderers **执行**保持默认关闭（风险备注）；desktop command 执行与渲染器桥接（`renderCall`/`setWidget`）留待 v2。

---

## 2. 当前运行架构

```text
Pi Desktop.app
├── React/WebView
│   ├── Session Workspace
│   ├── Endpoint Center
│   ├── Extension Marketplace
│   ├── Update Center
│   ├── Workspace Inspector
│   └── User PTY
├── Rust/Tauri Core
│   ├── SQLite Repository + Event Store
│   ├── Keychain Endpoint Store
│   ├── Worktree Manager
│   ├── Capability Broker + Policy Engine
│   ├── Attachment Store
│   ├── Extension Quarantine
│   ├── Official Marketplace Client
│   └── Pi-Agent/Extension Updater
└── Bundled Runtime
    ├── arm64 Node 25.6.1
    ├── bundled npm client
    ├── Pi Host coordinator
    └── one Pi Worker per active Task
```

运行边界：

- React 不能直接读取 Keychain、文件系统或启动进程；
- Tauri Rust Core 是所有外部能力入口；
- Pi Host 负责 Pi-Agent Session 和 Task Worker；
- 每个 Task Worker 绑定自己的 cwd、隔离模式、模型配置和 Session；
- 第三方扩展不直接加载到 Pi Host 主进程，而是在受限 Worker 中运行；
- 文件和 Shell 工具由 Capability Broker 根据 Task、路径、权限模式和一次性 Token 统一决策。

---

## 3. 用户可感知功能状态

状态定义：

- **完成**：主流程已实现并有自动测试或真实应用 smoke；
- **部分**：已有可用主干，但尚未达到 Claude Desktop 对标深度；
- **未实现**：尚无可用产品主流程。

| 能力 | 状态 | 当前实现 | 仍需完成 |
|---|---|---|---|
| 独立 macOS `.app` | 部分 | arm64 App、内置 Node/npm/Pi、独立 Pi 图标、ad-hoc 签名 | x64/Universal、Developer ID、公证、正式 DMG |
| Pi-Agent 内核 | 完成 | SDK 0.83.0、Protocol v2、Host/Worker | 后续 SDK 兼容矩阵 |
| 多 Task 并行 | 完成 | 每 Task 独立 Worker、cwd、状态 | 并发上限 UI、资源预算 |
| Git worktree | 完成 | 创建、检查、安全回收、dirty 拒绝 | Worktree 管理页面、Patch 导出 |
| Worker 恢复 | 完成 | 崩溃重建、事件序列与去重 | Safe Mode UI、用户可见恢复历史 |
| Task/Session 持久化 | 完成 | SQLite、归档、恢复、最近任务、搜索、重命名、Pin、Trash | Fork Tree |
| Chat/流式/Abort | 完成 | Host ACK、失败回滚、Pi Session 流、终止、冷启动自动重连 | Steer/Follow-up 队列 |
| Timeline | 完成 | Claude 风格消息层级、完整 Markdown/GFM、复制、Tool、状态与 Activity、三档密度、虚拟化 | — |
| Composer | 部分 | Prompt 始终可编辑、首次发送自动建 Session、附件、模型、权限、停止、草稿恢复 | `@` 搜索、粘贴图片、上下文 Token、Steer/Follow-up |
| 图片/文件附件 | 部分 | 私有复制、哈希、大小限制、图片转发 | PDF 解码/预览、目录 Context Handle |
| API Endpoint GUI | 完成 | Keychain、增删改、测试、默认模型 | Route Group、Fallback、能力矩阵 |
| 自动模型发现 | 完成 | OpenAI/Ollama 常见 `/models` 形态、去重 | Anthropic 深度探测、流式/Tool/Vision 测试 |
| Permission Mode | 完成 | Ask、Accept Edits、Plan、Auto fail-closed | 强隔离后开放真正 Auto |
| Capability Broker | 完成 | 路径、Symlink、文件、Shell、Token、撤销 | Network 域名策略 UI、审计检索 |
| Workspace Files | 完成 | 变更列表、全树搜索、轻量编辑器、二进制十六进制 Hex 预览 | 已支持全树搜索防抖、文件轻量编辑保存、二进制 Hex 格式化预览 |
| Diff | 完成 | Workspace Diff 查看、Hunk Keep/Revert | Hunk-level Revert/Keep、撤销、未跟踪文件管理、冲突拦截 |
| User Terminal | 完成 | 真 PTY、输入、Resize、停止、cwd | 多 Tab、历史和命令链接 |
| Command Palette | 完成 | `Cmd+K`、导航、重启、快捷键 | 全命令注册表与用户改键 |
| 统一 Settings | 部分 | 单一入口、模态窗口、搜索、Escape/关闭、`Cmd+,`、General、Models & API、Extensions & Updates、Runtime | Project Override、隐私/通知/快捷入口等高级分类 |
| 中英双语 | 完成 | 中文/English 切换、328 个实际使用键覆盖、重启持久化 | 后续新增文案的 CI 覆盖门禁 |
| 外观主题 | 完成 | System/Light/Dark、系统字体、Reduced Motion/Transparency | 高对比度主题与自动化截图矩阵 |
| App 图标 | 完成 | 原创 `π` 图标、1024 px RGBA、16/32/64 px 缩放检查、Bundle `.icns` | 发布前在多种 macOS 壁纸和辅助模式复核 |
| 本地扩展 | 完成 | 扫描、审批、快照、启停、回滚 | 更完整 Manifest Diff |
| 官方扩展市场 | 完成 | pi.dev 浏览、搜索、排序、分页 | 缓存、离线目录、详情页 |
| 市场扩展安装 | 完成 | 精确版本、私有 npm Cache、禁用 scripts | SBOM、签名/Provenance 展示 |
| 扩展升级 | 完成 | 单个、全部、启动时自动更新 | 保留策略和磁盘清理 |
| Pi-Agent 升级 | 完成 | 检查、不可变版本、协议预检、下次启动切换 | 长任务迁移和正式发布签名策略 |
| Preview/Browser | 未实现 | — | HTML/PDF/Image/Dev Server、Console |
| Side Chat | 未实现 | — | 上下文快照、不污染主线 |
| Quick Entry | 未实现 | — | 全局窗口、截图、最近 Task |
| Voice | 未实现 | — | macOS Dictation/本地 STT |
| 通知/Dock Badge | 未实现 | — | Waiting/Done/Failed |
| MCP/Connector | 未实现 | — | Local/Remote MCP、Keychain、Tool 审批 |
| Routines | 未实现 | — | 本地调度、重叠策略、运行历史 |

按照 V2 文档的 40 项清单粗评，当前为 14 项完成、15 项部分、11 项未实现，用户可感知能力覆盖约 `53.75%`。该数字只用于比较迭代前后覆盖，不代表发布质量。

### 3.1 本轮 Claude/Codex 交互升级

本轮没有复制 Claude 或 Codex 的品牌资产，而是吸收二者对独立 Agent 工具最有效的交互：

- 新任务页采用“项目 + Prompt”单焦点落地页，用户无需先理解 Session 生命周期；
- Prompt 在 Runtime 未就绪时仍可输入，真正不可执行的原因只影响发送按钮，并通过 Tooltip 明确说明；
- 首次发送等待 Host 对 `task.create` 的关联 ACK，再提交 `task.prompt`，避免双击、并发创建和失败后幽灵消息；
- 草稿按新任务或 Task ID 分区持久化，成功提交、归档或显式清空后删除；
- Sidebar 顶层只保留 Tasks 和 Settings，把低频配置收纳到统一设置中心；
- 设置中心使用左侧分类、右侧内容，端点、模型发现、扩展市场和更新仍使用原来的安全后端；
- `Cmd+,` 从任何工作区打开设置，`Cmd+K` 继续提供可搜索的键盘优先操作；
- 语言和主题是全局偏好，写入本机 `localStorage`，不进入项目、Session 或 Prompt 数据；
- 中文输入法 composition 期间不会误发送，`Enter`/`Shift+Enter` 行为保持一致。

主要文件：

- `apps/desktop/src/features/composer/Composer.tsx`
- `apps/desktop/src/features/settings/SettingsCenter.tsx`
- `apps/desktop/src/i18n/I18nProvider.tsx`
- `apps/desktop/src/components/Sidebar.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/design-system/tokens.css`

### 3.2 发送与托管扩展加载链路修复

2026-07-30 的真实 `.app` 回归定位到四个相互叠加的问题：

1. Rust 对扩展目录使用 `PathBuf` 分量顺序计算完整树哈希，而 Node Worker 曾按完整绝对路径字符串重新排序；当目录名与同前缀文件名并存时，两端哈希顺序不同；
2. npm 隔离区的根目录是包装项目，真正的 Pi 扩展入口由包装项目 `package.json` 的 `pi.extensions` 指向；Worker 曾把根目录本身交给 Pi SDK；
3. 任一托管扩展启动失败会使整个 Task Session 创建失败；
4. 前端过去把 Tauri 已接收 JSONL 命令误当成 Pi Host 已执行成功，导致创建失败后仍提交 Prompt，并显示空白 Pi 消息。

修复后的契约：

- Node 和 Rust 使用一致的目录遍历顺序与边界，完整树哈希对真实已安装快照完全一致；
- 扩展入口必须来自隔离根目录内的文件、`pi.extensions` 或受控的 `index` 后备入口，真实路径逃逸会被拒绝；
- 扩展 Worker 逐个启动，失败项写入 Task Warning 并被隔离，其他扩展和核心 Pi Session 继续运行；
- 每个桌面命令最多等待 45 秒的 Host ACK；超时、拒绝或 Host 退出都会明确失败；
- `task.create` 未确认时不发送初始 Prompt；`task.prompt` 未确认时回滚本轮乐观 UI，并恢复 Prompt 草稿；
- App 启动后优先启动 Pi Host，自动更新在后台运行，更新网络等待不再阻塞输入和发送。

主要文件：

- `packages/pi-agent-host/src/runtime/snapshot-integrity.ts`
- `packages/pi-agent-host/src/runtime/managed-extension-entries.ts`
- `packages/pi-agent-host/src/runtime/managed-extension-worker.ts`
- `packages/pi-agent-host/src/runtime/desktop-host.ts`
- `apps/desktop/src/App.tsx`
- `packages/protocol/src/messages.ts`
- `apps/desktop/src-tauri/src/agent/protocol.rs`

### 3.3 Claude Desktop 基准重构与 Pi 超越项

本轮以本机已安装的 Claude Desktop 1.24012.9 为可执行基准，实际检查了新任务页、已有 Cowork 任务、右侧进度/项目面板和 Settings 模态窗口。实现目标不是复制品牌资产，而是复现其信息层级、空间节奏和低干扰交互，再保留 Pi 作为本地 Agent 的工程能力。

已落地的 Claude 同构部分：

- 侧栏收敛为 200 px，并支持折叠为 60 px；窗口变窄时自动退化为图标导航；
- 顶部使用 Agent/Configure 分段入口，主导航聚焦 New task、Projects 和 Recents；
- 新任务页采用大标题、单一主 Composer 和紧邻的项目/文件夹条；
- 已有任务使用约 650 px 的窄幅对话列，用户消息右侧气泡、Pi 消息正文平铺；
- Composer 固定在对话底部，并把附件、模型和发送状态收敛到同一操作面；
- 右侧检查器先显示 Progress，再显示 Project Diff/Files；
- Settings 使用带背景模糊的居中模态窗口，左侧搜索与分类、右侧详情，支持 Escape 关闭；
- 深色主题改为更克制的暖灰层级，同时保留浅色、系统跟随、Reduced Motion 和 Reduced Transparency。

超过 Claude 的 Pi 专属部分：

- 在新任务 Composer 中直接选择自定义 API Endpoint、自动发现的模型、权限模式和 worktree/只读/当前 checkout 隔离；
- 对话旁原生显示 Git Diff、项目文件、真实 PTY Terminal 和 Capability Broker 审批；
- 历史任务冷启动自动重建独立 Pi Worker，Event Store 重放不会伪造“已连接”状态；
- 官方扩展市场、不可变快照审查、受限扩展 Worker、Pi-Agent Core 自动升级均在统一 Settings 内完成；
- Endpoint Secret 使用 macOS Keychain，任务、事件、扩展和更新状态默认本地保存。

主要文件：

- `apps/desktop/src/features/sessions/SessionSidebar.tsx`
- `apps/desktop/src/features/sessions/SessionWorkspace.tsx`
- `apps/desktop/src/features/timeline/Timeline.tsx`
- `apps/desktop/src/features/composer/Composer.tsx`
- `apps/desktop/src/features/workspace/WorkspaceInspector.tsx`
- `apps/desktop/src/features/settings/SettingsCenter.tsx`
- `apps/desktop/src/i18n/I18nProvider.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/design-system/tokens.css`

---

## 4. Endpoint 自动模型发现

### 4.1 用户流程

1. 用户选择 Endpoint 类型；
2. 输入 Base URL；
3. 输入 API Key；
4. 当 URL 和 Key 达到可请求状态后，前端等待 700 ms；
5. Rust 从内存中的 Draft 和 Keychain Secret 发起探测；
6. 解析常见 OpenAI Compatible 或 Ollama 模型响应；
7. 去重并回填模型列表；
8. 默认选择第一个可用模型；
9. 用户仍可手动覆盖模型列表和默认模型；
10. 已保存 Endpoint 可以通过 `Refresh models` 重新发现并持久化。

### 4.2 安全约束

- API Key 不进入 React 持久状态文件、SQLite 或日志；
- Base URL 不允许嵌入用户名和密码；
- 探测失败只显示脱敏错误；
- 自动发现不自动启用未知 Endpoint；
- 手动模型列表始终保留为离线和非标准 API 的后备路径。

### 4.3 主要文件

- `apps/desktop/src/features/endpoints/EndpointCenter.tsx`
- `apps/desktop/src/platform/tauri/bridge.ts`
- `apps/desktop/src-tauri/src/storage/endpoints.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `packages/protocol/src/messages.ts`

---

## 5. 官方扩展市场与安装

### 5.1 目录来源

应用直接读取 `https://pi.dev/packages?type=extension`。当前支持：

- 按下载量、最近发布和名称排序；
- 名称搜索；
- 页码浏览；
- 展示包名、说明、作者、版本、类型和下载量；
- 从目录卡片选择 `Add for review`。

### 5.2 安装管线

```text
pi.dev catalog
  → npm registry /latest identity check
  → validate package name and exact version
  → private staging directory
  → bundled npm --ignore-scripts --omit=dev
  → validate installed name/version
  → read package.json pi.extensions
  → bounded source scan
  → full-tree SHA-256
  → immutable quarantine snapshot
  → disabled/review state
  → exact-hash user approval
  → restricted Extension Worker
```

安全行为：

- 安装命令不经过 Shell 字符串拼接；
- 包名和版本拒绝 Shell 元字符；
- npm 使用 App Data 下独立 Cache，不依赖 `~/.npm`；
- lifecycle scripts 始终关闭；
- 完整快照最多 20,000 个文件、256 MiB；
- Worker 只加载包装项目 Manifest 声明且位于隔离根目录内的扩展入口；
- 发现进程、文件、网络或依赖能力时展示 Warning/Critical；
- Warning/Critical 必须再次点击并批准当前内容哈希；
- 快照内容被修改后，Worker 在执行前拒绝加载；
- 更新产生新版本，不原地覆盖旧快照。

### 5.3 更新策略

- 信息级发现：如果旧版本已启用，新版本完成扫描后保持启用；
- Warning/Critical：新版本安装成功但自动停用，等待重新审查；
- 单个更新和 `Update all` 共享同一安装管线；
- Pi Host 优先启动，自动更新在后台运行；新核心在下一次 Host 启动时切换；
- 一个扩展更新失败不会阻塞其他扩展或 Pi Desktop 启动；
- 失败被记录到 `AutomaticUpdateReport.errors` 并显示为非致命警告。

---

## 6. Pi-Agent Core 更新

### 6.1 更新流程

```text
npm registry latest
  → semver compare
  → copy bundled Pi Host to staging
  → preserve private Desktop Protocol
  → bundled npm install exact Pi-Agent
  → verify installed package version
  → start staged Host with bundled Node
  → host.bootstrap
  → require host.hello / Protocol 2 / expected SDK version
  → make entire runtime read-only
  → atomic rename to packages/pi-agent/<version>
  → write active runtime marker
  → use on next Host start
```

### 6.2 防回退与失败行为

- 只有比当前有效 Runtime 更新的 SemVer 才会安装；
- App Bundle 自带版本高于托管版本时，优先使用 Bundle，不允许旧托管版本降级；
- Staging 失败会删除临时目录，不改变 Active Runtime；
- 预检失败不会写入 Active Marker；
- 新版本首次启动后清除 `restartRequired`；
- 手动更新不会强行中断当前正在执行的 Task；
- 启动时自动更新不会阻塞当前 Host；通过预检的新版本在下一次 Host 启动时生效。

### 6.3 当前发布边界

Pi-Agent Core 可以作为经过预检的不可变运行时覆盖层更新；Tauri/Rust/UI 本体仍只能通过签名 App 更新。正式 1.0 还必须增加：

- 更新包来源签名或可验证 Provenance；
- Developer ID 签名；
- Apple Notary；
- App 本体 Sparkle/Tauri Updater；
- 更新失败后的可视化回滚；
- 保留版本和磁盘上限。

---

## 7. 本轮验证证据

### 7.1 自动测试

| 测试面 | 结果 |
|---|---:|
| Desktop Protocol | 4/4 通过 |
| Pi Host Smoke | 19/19 通过 |
| Rust/Tauri 单元与集成测试 | 44/44 通过，1 项 live test 默认忽略 |
| TypeScript 类型检查 | 通过 |
| Vite Production Build | 通过 |
| Rust Format Check | 通过 |

完整命令：

```bash
npm run desktop:verify
```

另运行 TypeScript AST 文案覆盖检查：当前 UI 实际调用 328 个翻译键，中文表包含 363 个键，缺失为 0。

### 7.2 真实 macOS GUI 回归

最终 Release `.app` 使用系统辅助功能树完成了以下人工回归：

- Release 包显示 `Pi 已就绪 · SDK 0.83.0`，Prompt 可聚焦并通过中文输入；
- 第一轮发送“只回复 OK，不要调用任何工具。”后，按钮进入运行态，Pi 返回 `OK`，任务恢复为已完成；
- 同一 Session 第二轮发送“再只回复 READY，不要调用任何工具。”，Pi 返回 `READY`；
- 两轮均先显示用户消息和“Pi 正在工作”，收到终态后解除 Stop/Archive 锁定；
- Activity 只在 Host ACK 后记录“提示词已提交”，没有快照哈希、未知 Worker 或扩展启动错误；
- 两轮回归后 Git Worktree 仍为 0 改动；
- 按本机 Claude Desktop 1.24012.9 完成新任务、任务会话、右侧 Progress/Project 和 Settings 四个关键状态的视觉对照；
- 新任务 Composer 已从窗口底部上移到主标题下方，项目条与 Composer 形成一个连续组件；
- Timeline 中真实历史响应的标题、列表、粗体和分隔线均按 GFM 渲染，辅助功能树可识别标题与列表语义；
- `Cmd+,`、Sidebar Settings 和设置内四个分类均可达；
- Settings 搜索、背景点击关闭、关闭按钮和 Escape 均可达；
- 中文切到 English 后退出并重启，语言保持；最终切回中文；
- System/Light/Dark 主题切换和持久化通过；
- Models & API 显示当前 Endpoint，并可进入新增/编辑表单；
- Extensions & Updates 显示自动更新选项和已安装扩展；
- Official Marketplace 在真实 App 中联网加载扩展卡片；未执行测试安装；
- 完全退出 Release `.app` 后重新启动，历史任务先显示 Saved，再自动恢复 Worker；同一任务发送“只回复 CLAUDE-PARITY-OK，不要调用工具。”成功返回 `CLAUDE-PARITY-OK`；
- 冷启动重连修复前可稳定复现 `Unknown or stopped Pi Task Worker`，修复后 Event Store 重放不再污染 live Worker 状态；
- 最终关闭测试路径和 Prompt，App 停留在干净的中文 Tasks 首页。

### 7.3 真实联网与安装验证

- 官方 `pi.dev` 扩展目录 live test：通过；
- 应用内目录：成功显示 63 页官方扩展；
- npm 精确版本 smoke：`@vigolium/piolium@0.0.13` 安装成功；
- 当前 App Data 中两个已启用扩展的 Node/Rust 完整树哈希与持久化值一致；
- `@vigolium/piolium` 包装 Manifest 入口解析成功；`pi-web-access` Worker 成功注册 `web_search`、`source_check`、`fetch_content` 和 `get_search_content`；
- 两个真实扩展 Worker 均可启动，失败列表为空；
- 系统 `~/.npm` 存在 root-owned 缓存时，普通 npm 会失败；
- 设置独立 `NPM_CONFIG_CACHE` 后安装成功，验证桌面实现可绕开用户损坏缓存；
- 独立 npm Cache smoke 使用的临时目录已清理，没有把该次临时安装重复写入 Pi Desktop 配置。

### 7.4 `.app` 验证

| 检查 | 结果 |
|---|---|
| 主二进制架构 | arm64 |
| 内置 Node 架构 | arm64 |
| 内置 npm | 存在 |
| 内置 Pi Host | 存在 |
| Ad-hoc 深度签名 | `codesign --verify --deep --strict` 通过 |
| Bundle Host Smoke | Protocol 2、SDK 0.83.0、Ready |
| GUI 启动 | 通过 |
| Update Center | 状态查询、设置持久化通过 |
| Marketplace | 应用内真实加载通过 |
| App Icon | 1024 × 1024 RGBA 母版；透明四角；16/32/64 px 可辨；Bundle `.icns` 已替换 |
| 当前体积 | 约 346 MiB |

Bundle smoke：

```bash
npm run desktop:bundle:smoke
```

当前 App：

```text
apps/desktop/src-tauri/target/release/bundle/macos/Pi Desktop.app
```

图标源文件：

```text
resources/icon.png
resources/icon@2x.png
resources/app-icon-source-chroma.png
```

当前机器使用 macOS 27 beta Command Line Tools。系统 `ld` 在链接 Rust
proc-macro 动态库时会产生 `mis-aligned LINKEDIT string pool`，导致动态加载失败。
项目已增加 `.cargo/config.toml` 和 `.cargo/rust-lld-linker.sh`，仅对 Apple target
使用 Rust 工具链内置 `ld64.lld`。最小 proc-macro 动态加载、`cargo test` 和 Release
App 构建均已通过；该兼容层应在正式 CI 的稳定 Xcode 版本上再次评估，若系统链接器
问题消失即可删除并回退默认 linker。

DMG 脚本已经提供，但当前受控运行环境无法使用 DiskManagement framework，因此本轮没有伪造“DMG 已成功”的结论：

```bash
npm run desktop:dmg
```

---

## 8. 当前数据与安全状态

| 数据 | 存储 | 权限/策略 |
|---|---|---|
| Task/Event | SQLite WAL | App Data 私有目录 |
| Endpoint 配置 | JSON/SQLite 视图 | 不含 Secret |
| API Key | macOS Keychain | 按 Endpoint ID |
| 附件 | App Data 私有副本 | Hash、大小限制 |
| Extension Store | `extensions.json` | `0600` |
| Extension Snapshot | `packages/extensions` | 不可变目录 |
| Pi 更新状态 | `updates.json` | `0600` |
| Pi Core Overlay | `packages/pi-agent/<version>` | 不可变目录 |
| Worktree | App 管理目录 | dirty 时拒绝删除 |

仍需处理：

- Extension 删除目前只删除注册记录，不清理所有历史快照；
- 更新保留数量和磁盘上限尚未实现；
- 审计日志尚无完整检索 UI；
- 自动更新错误只显示会话级警告，尚无长期 Update History；
- 当前 ad-hoc 签名只适合本机验证，不适合对外分发。

---

## 9. 后续无折扣实施计划

### 9.1 P0：完成 Core Workspace

| ID | 工作 | 依赖 | 估算 | 验收 | 风险与回滚 |
|---|---|---|---:|---|---|
| NEXT-U01 | Multi-file Diff + Hunk Keep/Revert | Broker、Worktree | 6 人日 | ✅ 外部修改、冲突、Symlink、dirty 分支测试；操作可撤销 | 首版只读 Diff 保留为回退 |
| NEXT-U02 | Files Search + Light Editor | Workspace API | 5 人日 | ✅ 10k 文件、二进制、编码、磁盘冲突 | 写入能力 Feature Flag |
| NEXT-U03 | Timeline GFM + 三档密度 + 虚拟化 | Event Store | 6 人日 | ✅ 10k Event、代码块、表格、复制、VoiceOver | 回退当前 Normal Renderer |
| NEXT-U04 | Session Rename/Search/Pin/Trash | SQLite | 5 人日 | ✅ 归档恢复、LIKE 搜索、Pin、Trash 手动删除 | 30 天自动清理留待后续；不物理删除 Worktree |
| NEXT-U05 | Pane Layout v1 | U01–U03 | 7 人日 | ✅ Chat/Diff/File/Terminal 拆分、恢复、预设、窄窗切页 | 保留固定 Workspace 布局 |

### 9.2 P1：完成日常 Agent 工作流

| ID | 工作 | 依赖 | 估算 | 验收 | 风险与回滚 |
|---|---|---|---:|---|---|
| NEXT-W01 | Preview/Dev Server | Pane、Broker | 7 人日 | ✅ HTML/Image/PDF 静态预览、独立本地 Origin、Console 日志；端口审批留待 v2 | 静态 Preview 先行 |
| NEXT-W02 | Session Tree/Fork/Compaction | Pi Session Contract | 6 人日 | ✅ 只读会话树、压缩/分支标记、当前叶子高亮；交互式 Fork/Compact 留待 v2 | 只读 Tree Feature Flag |
| NEXT-W03 | Steer/Follow-up Queue | Pi Host | 4 人日 | ✅ 运行中跟进排队、顺序、取消全部、队列持久化+恢复重提、IME | 继续单轮发送 |
| NEXT-W04 | Notification + Dock Badge | Tauri Plugin | 3 人日 | ✅ Waiting/Done/Failed 原生通知、Dock 徽标（等待+失败）、Focus 抑制、设置总开关 | 无通知即现状 |
| NEXT-W05 | Quick Entry + Screenshot | W03、Attachment | 7 人日 | ✅ 全局快捷键唤起 Quick Entry、整屏截图、Screen Recording 拒绝降级 | 普通主窗口入口保留 |

### 9.3 P2：开放生态与发布

| ID | 工作 | 依赖 | 估算 | 验收 | 风险与回滚 |
|---|---|---|---:|---|---|
| NEXT-E01 | Extension Hook/Command/Renderer Contract | Worker、Broker | 8 人日 | ✅ 契约+声明面通告+能力清单+友好审批；hooks/commands/renderers 执行默认关 | 自定义 Tool 以外默认关闭 |
| NEXT-E02 | Skills/Prompts/Themes 管理 | Resource Model | 5 人日 | 安装、启停、Scope、导入导出 | 保留 Local Extension 页 |
| NEXT-E03 | MCP/Connector Center | Broker、Keychain | 8 人日 | Local/Remote、Schema、审批、重连 | 总开关关闭 |
| NEXT-P01 | x64 + Universal Build | CI、Runtime Stage | 4 人日 | 两种架构真机启动和 Host Smoke | 分别发布 arm64/x64 |
| NEXT-P02 | Developer ID + Notary + DMG | Apple 凭据 | 3 人日 | Gatekeeper 干净机安装 | 保留本地 ad-hoc App |
| NEXT-P03 | App Updater + Rollback | P02 | 5 人日 | 签名更新、失败回退、DB Migration | Updater Feature Flag |

### 9.4 建议 Sprint

| Sprint | 主要交付 |
|---|---|
| S1 | Diff Hunk、Files Search、Session 生命周期 |
| S2 | Timeline、Pane Layout、Steer Queue |
| S3 | Preview、通知、Quick Entry |
| S4 | Extension 完整资源类型、MCP |
| S5 | Universal、签名、公证、Updater、干净机发布验证 |

每个 Sprint 的完成条件：

1. 功能代码和失败路径同时完成；
2. Rust/Protocol/Host/UI 测试通过；
3. 至少一次真实 `.app` smoke；
4. 更新本文档的状态和证据；
5. 不以视觉 Mock 或 README 声明替代真实运行结果。
