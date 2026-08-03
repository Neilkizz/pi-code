# Pi Desktop V3：正式交付与领先性实施方案

> 文档状态：V3 总体交付基线  
> 基线日期：2026-07-30  
> 适用分支：`improvement-v4`  
> 产品形态：完全独立的 macOS Agent App  
> 唯一 Agent 内核：Pi-Agent  
> 目标：补齐 ChatGPT Desktop 与 Claude Desktop 的成熟体验，并在本地 Agent、开放模型、可审计执行和开发工作流上形成可测量的领先优势

---

## 0. 执行摘要

### 0.1 当前结论

当前 Pi Desktop 已经具备独立应用、Pi-Agent 托管、自定义 API 端点、模型发现、扩展市场、Keychain、权限 Broker、任务工作区、Markdown、PTY、更新链路等关键底座，但整体仍属于**工程 Alpha**，不满足公开正式交付标准。

主要问题不是“再补几个页面”，而是六类系统性差距：

1. **产品结构不完整**：当前顶层只有 Tasks 与 Settings，Projects、Artifacts、Automations、Library、Quick Entry 等尚未形成完整产品闭环。
2. **交互语言不统一**：`App.tsx` 和全局样式过度集中，大量补丁式覆盖、极小字号、空白区和不一致状态造成明显的“工程界面感”。
3. **任务过程不够可理解**：缺少成熟的 Progress、Tool Group、Context、Memory、Approval、Diff Review、Checkpoint 和恢复体验。
4. **成品交付能力不足**：目前擅长对话和代码执行，但缺少文档、表格、演示、网页、预览和版本化 Artifact 工作流。
5. **桌面原生能力不足**：缺少快速窗口、全局快捷键、通知、深链、菜单栏、窗口恢复、系统分享、辅助功能和多窗口策略。
6. **质量与发布体系不足**：没有前端组件测试、GUI E2E、视觉回归、性能预算、Universal 构建、Developer ID 签名、公证和可靠自动更新验收。

因此，后续不得继续以追加 CSS 和在 `App.tsx` 中堆叠状态为主要开发方式。V3 的第一阶段必须先建立设计系统、产品路由、状态投影和测试基座。

### 0.2 正式定位

> Pi Desktop 是一个由用户掌控模型、数据、工具和扩展的本地优先 Agent 工作台。它以 Pi-Agent 为唯一执行内核，用同一套可信任务系统覆盖快速问答、复杂工作和软件构建。

Pi Desktop 不以复制竞品品牌和像素为目标，而采用：

- **Claude 的克制、任务感、上下文透明度和低干扰交互；**
- **ChatGPT 的多模式入口、成品型工作流、Canvas、桌面快速调用和生态连接；**
- **Pi 的多端点自由、本地可控、可审计执行、扩展开放性和开发工作区能力。**

### 0.3 “超越”必须可验证

“超越 ChatGPT 与 Claude”不能由视觉主观判断得出。只有同时满足以下条件才能对外使用这一表述：

1. P0 核心流程完成率达到 100%，不存在无法发送、无法输入、状态假成功、重启丢任务等阻断问题；
2. ChatGPT/Claude 的基础桌面体验覆盖率达到本方案定义的 95%；
3. 在开放端点、本地模型、扩展隔离、任务审计、工作树隔离、恢复能力六项上全部达到领先指标；
4. 10 名目标用户的基准任务测试中，核心任务成功率不低于 95%，中位完成时间至少比竞品组合流程缩短 20%；
5. 正式发布门禁全部通过，包括签名、公证、Universal、自动更新、辅助功能、安全审计和崩溃恢复。

---

## 1. 研究范围与证据

### 1.1 本机实机基准

本轮以当前机器上的正式应用进行只读观察：

| 应用 | 本机版本 | 观察重点 |
|---|---:|---|
| Claude Desktop | 1.24012.9 | Cowork、New Task、任务历史、右侧 Progress/Project/Context、Settings、导航和 Composer |
| ChatGPT | 26.721.81911 | 本机安装版本与应用形态；界面细节以 OpenAI 官方当前文档补充 |
| ChatGPT Classic | 1.2026.160 | 经典桌面能力范围与版本信息 |
| Pi Desktop | 0.1.0 | 当前任务页、侧栏、检查器、Composer、Settings、代码和发布配置 |

本机 Claude 的高价值特征：

- 约 200 px 的克制侧栏，New Task、Projects、Artifacts、Scheduled、Customize 层级明确；
- 新任务页面只有一个主要意图，Composer 与项目上下文紧密相邻；
- 工具调用按语义分组折叠，用户先看到结论，再按需展开执行细节；
- 任务右侧固定展示 Progress、Project files、Context/Memory；
- Settings 是带背景虚化的统一模态，左侧搜索与分组导航清晰；
- 历史任务具备未读、分组、更多操作和细粒度消息操作；
- 视觉节奏安静，文字列宽稳定，主内容与工具信息不会互相争夺注意力。

### 1.2 官方能力基准

ChatGPT 当前桌面方向：

- Chat、Work、Codex 三类工作意图统一切换；
- Work 支持长时、多步骤任务、审批、进度和成品文件；
- Canvas 支持并排编辑、局部选择、内联修改和版本恢复；
- Projects 统一管理对话、文件、指令与记忆；
- 桌面快速入口、截图、语音、录音、通知、任务和跨设备协作；
- Apps、插件、MCP 和连接器形成统一扩展入口。

Claude 当前桌面方向：

- Cowork 以任务为中心，强调计划、进度、上下文、项目文件和可中断性；
- Projects 为本地任务提供稳定文件、指令和记忆边界；
- Skills、Connectors、Plugins 在统一目录中发现和管理；
- Scheduled tasks、Computer Use、Live Artifacts、Dispatch 扩展桌面执行范围；
- 权限、工具分组和低干扰界面降低复杂 Agent 工作的认知负担。

官方资料索引见本文第 18 节。

---

## 2. 当前项目审计

### 2.1 已有优势

以下能力应保留并升级，不应重写为第二套 Agent：

- Tauri + React + Rust 独立 macOS 应用；
- 内置 Node、Pi Host 与 Pi-Agent，不要求系统安装 Node 或 Pi CLI；
- 一任务一 Worker、任务 cwd 和 Git worktree 隔离；
- SQLite Event Store 与任务恢复；
- Capability Broker、一次性授权、路径与工具权限；
- Keychain 保存 Endpoint Key；
- 自定义 API Endpoint、连接测试和模型列表发现；
- Pi 官方扩展市场、不可变扩展快照、能力扫描与隔离加载；
- Pi-Agent 与扩展检查更新、预检和回滚；
- 中英文、浅色/深色、高对比、Reduced Motion/Transparency 基础；
- Markdown/GFM Timeline、附件、真实 PTY、基础文件与 Diff 面板；
- 发送确认、乐观消息回滚、Worker 重建等关键可靠性修复。

### 2.2 结构性技术债

| 范围 | 当前证据 | 风险 | V3 决策 |
|---|---|---|---|
| 前端入口 | `apps/desktop/src/App.tsx` 约 1,349 行 | 路由、状态、窗口、任务逻辑耦合 | 拆分 App Kernel、路由、命令和 Feature Slice |
| 全局样式 | `styles.css` 约 4,100 行，存在大量 7–10 px 字号和覆盖层 | 视觉不可预测、可访问性差、回归困难 | 新建语义 Token 与组件层，逐页删除旧覆盖 |
| 产品路由 | 仅 `tasks / settings` | 无法承载 Projects、Artifacts、Automations | 引入 typed route 与 workspace registry |
| Settings | 仅 General、Endpoints、Extensions、Runtime | 安全、隐私、通知、快捷键、存储、更新不可见 | 建立可搜索统一设置中心 |
| 前端测试 | 无组件测试与 GUI E2E | 输入/发送等核心问题可重复出现 | Vitest + Testing Library + Playwright/Webdriver |
| 数据库表面 | 已有 Projects、Routines、Layouts 等表，但无完整 UI/IPC | Schema 与用户功能脱节 | 以 Repository + Command + Projection 暴露真实功能 |
| 桌面插件 | 只有 Dialog | 快捷键、通知、深链、更新、窗口恢复缺失 | 按威胁模型引入受控 Tauri 插件 |
| 发布 | arm64、adhoc、无公证 | 无法正式分发和可信升级 | Universal + Developer ID + Notarization + Updater |
| CI | 单 macOS verify | 无视觉、安全、性能、产物门禁 | 多层质量流水线与 Release Gate |

### 2.3 当前交付等级

| 维度 | 当前等级 | 正式交付最低要求 |
|---|---:|---:|
| 可运行主流程 | B- | A |
| 信息架构 | C | A- |
| UI 一致性 | C- | A- |
| Agent 过程可理解性 | C+ | A |
| Artifact 成品能力 | D | B+ |
| 桌面原生体验 | D+ | A- |
| 生态与端点 | B | A |
| 安全隔离 | B+ | A |
| 测试与可观测性 | C- | A |
| 发布工程 | D | A |

---

## 3. 三种工作模式

Pi Desktop 顶层使用 `Ask / Work / Build`，三者共享 Pi-Agent、任务记录、模型端点和扩展系统，不复制三套执行逻辑。

### 3.1 Ask：即时而轻量

适合解释、搜索、草拟、翻译、图片理解和不需要长期项目的快速任务。

- 默认不要求选择文件夹；
- Composer 首屏可直接输入；
- 支持临时附件、截图、语音和快速模型切换；
- 可以一键升级为 Work 或 Build，保留完整上下文；
- 全局快捷键打开 440–560 px 的 Quick Pi 窗口。

### 3.2 Work：从任务到成品

适合研究、报告、文档、表格、演示、网页和周期性任务。

- 有计划、进度、来源、上下文、附件和成品区；
- Artifact 可预览、局部编辑、比较、恢复、导出；
- 可使用 Skills、Connectors、Plugins 和 Browser；
- 支持定时、触发、重跑和完成通知；
- 用户可随时修改目标、回答问题或审批关键动作。

### 3.3 Build：可信软件工程

适合仓库分析、编码、测试、审查和多任务开发。

- Project、Repository、Branch、Worktree 是一等对象；
- 内置 Files、Search、Diff、Terminal、Preview、Problems 和 Test；
- 变更按文件与任务归因，提交前必须可完整审查；
- 支持多个任务并行但隔离，允许显式合并；
- 可记录命令、退出码、测试证据、权限和恢复点。

### 3.4 模式转换原则

- 转换只改变工作台布局、默认工具和权限提示，不改变历史任务 ID；
- Ask → Build 时必须明确选择项目和隔离方式；
- Work → Automations 时必须生成可审查的计划、触发条件和权限快照；
- Build → Work 可将代码结果、图表和报告发布为 Artifact；
- 每次转换都必须可撤销。

---

## 4. 信息架构

### 4.1 全局结构

```text
Pi Desktop
├── Mode Switcher: Ask / Work / Build
├── New Task
├── Projects
├── Artifacts
├── Automations
├── Library
├── Extensions
├── Recents
│   ├── Pinned
│   ├── Today
│   ├── Previous 7 days
│   └── Older
└── Account & Runtime
    ├── Active endpoint/model
    ├── Runtime health
    ├── Updates
    └── Settings
```

### 4.2 主工作台

```text
┌──────────── Sidebar ────────────┬──────────── Main workspace ─────────────┬──── Inspector ────┐
│ Mode / New Task                │ Toolbar / breadcrumb / task actions     │ Progress          │
│ Projects / Artifacts           │                                        │ Context & memory  │
│ Automations / Library          │ Timeline, Canvas, Diff or Preview       │ Files / sources   │
│ Recent tasks                   │                                        │ Permissions       │
│ Runtime / Settings             │ Composer / mode / model / tools         │ Activity          │
└────────────────────────────────┴────────────────────────────────────────┴────────────────────┘
```

### 4.3 响应式窗口

| 窗口宽度 | 布局 |
|---:|---|
| ≥ 1,600 px | 侧栏 + 主区 + 常驻检查器 |
| 1,100–1,599 px | 侧栏 + 主区；检查器为可开合抽屉 |
| 760–1,099 px | 折叠侧栏；Pane 以标签/抽屉切换 |
| 440–759 px | Quick Pi 或单列任务阅读模式 |

主窗口最小宽度从当前 1,080 px 降为 760 px；Quick Pi 使用独立窗口约束，不复用主窗口最小尺寸。

---

## 5. 视觉与交互系统

### 5.1 设计原则

1. **内容优先**：色彩、玻璃和阴影只用于层级，不占据注意力。
2. **状态真实**：所有 Running、Waiting、Done、Failed 都来自 Runtime/Event Projection。
3. **复杂度渐进披露**：默认展示结果和下一步，工具参数、日志和策略按需展开。
4. **键盘优先但鼠标完整**：每个核心动作有键盘路径，也有明确按钮和菜单。
5. **安静但不含糊**：克制视觉不能以降低可发现性和对比度为代价。
6. **可恢复感**：危险动作前可理解，失败后有解释，任务中断后有恢复入口。

### 5.2 设计 Token

| Token | 规范 |
|---|---|
| 基础间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48 |
| 正文 | 14 px / 21 px |
| 辅助正文 | 13 px / 19 px |
| 最小可见字号 | 11 px；产品 UI 禁止低于该值 |
| 标题 | 17 / 22 / 28 / 36 px |
| 控件高度 | 28 / 32 / 36 / 44 px |
| 圆角 | 6 / 10 / 14 / 18 px |
| 文本列宽 | 680–760 px |
| 侧栏 | 默认 232 px，最小 196 px，最大 320 px，折叠 64 px |
| 顶部工具栏 | 44–48 px |
| 焦点环 | 2 px，必须在浅色、深色、高对比下可辨识 |
| 动效 | 120–220 ms；Reduced Motion 下取消位移与缩放 |

### 5.3 材质策略

- 仅侧栏、工具栏、模态背景和浮层可使用系统材质；
- 对话内容、Diff、Terminal、表格和长文档使用稳定实色背景；
- Reduced Transparency 下自动切换为不透明语义色；
- 不复制竞品精确色值、图标和品牌资产；
- 所有交互状态至少通过两种信号表达，不只依赖颜色。

### 5.4 核心组件

必须建立独立组件与 Story/Fixture：

- `Button`、`IconButton`、`SegmentedControl`、`Field`、`Select`、`SearchField`
- `Popover`、`Menu`、`Tooltip`、`Dialog`、`Sheet`、`Toast`
- `SidebarItem`、`TaskRow`、`StatusBadge`、`UnreadDot`
- `Composer`、`AttachmentChip`、`ModelPicker`、`ToolPicker`
- `TimelineMessage`、`ToolGroup`、`ApprovalCard`、`ProgressCard`
- `InspectorSection`、`FileTree`、`DiffViewer`、`ArtifactFrame`
- `EmptyState`、`ErrorState`、`Skeleton`、`OfflineBanner`

组件通过语义 Variant 控制状态，禁止业务页面复制一套私有按钮、输入框和弹窗 CSS。

### 5.5 Composer 规范

- 新任务状态永远可以输入，不依赖 Worker 是否已经创建；
- `Enter` 发送、`Shift+Enter` 换行，IME 组合期间绝不发送；
- 发送后 100 ms 内出现确定的本地受理状态；
- Host 确认前为 `Submitting`，确认后才变为 `Sent`；
- 失败必须恢复草稿、附件、光标位置和选中范围；
- 支持文件、文件夹、截图、剪贴板、语音、连接器和 Slash Command；
- 模型、权限模式、工具集可在 Composer 内查看，但高级项默认折叠；
- Stop、Retry、Edit & resend、Branch from message 的状态机必须互斥且可测试。

### 5.6 Timeline 规范

- 文本消息保持稳定列宽，避免大段左右摆动；
- Tool Call 按目标和时间聚合，如“读取 11 个文件”“更新 4 个文件”；
- Progress 只展示可验证步骤，不把模型思考过程作为产品内容；
- 每组工具显示状态、耗时、影响范围和展开入口；
- 长会话必须虚拟化，10,000 个事件仍可流畅滚动；
- 用户向上阅读时禁止自动抢滚动；底部出现“回到最新”；
- 每条消息支持复制、编辑、重试、从此分支、时间和上下文菜单；
- 错误按可恢复、需授权、配置错误、运行时错误分类，不显示原始堆栈作为主文案。

### 5.7 设置中心

统一设置模态分组：

```text
Settings
├── General
├── Appearance
├── Language
├── Notifications
├── Keyboard shortcuts
├── Privacy & data
├── Security & permissions
├── Models & endpoints
├── Routing & budgets
├── Extensions
├── Connectors & MCP
├── Pi-Agent runtime
├── Updates
├── Storage & backups
├── Developer
└── About & diagnostics
```

要求：

- 左侧可搜索，搜索结果直达字段；
- 所有修改显示保存状态，危险操作有影响说明；
- Endpoint Key 永不回显完整值；
- 更新、日志、诊断和恢复不再分散到隐藏入口；
- 中英文文案长度变化必须在 760 px 最小窗口下通过截图测试。

---

## 6. 能力矩阵

| 领域 | ChatGPT 强项 | Claude 强项 | Pi 当前 | Pi V3 目标 |
|---|---|---|---|---|
| 模式 | Chat/Work/Codex | Chat/Cowork/Code | 单任务工作台 | Ask/Work/Build 共享同一任务内核 |
| 新任务 | 多入口、快速调用 | 单焦点、低干扰 | 可发送但入口单一 | Quick Pi + 主窗口 + 深链 |
| 历史 | Recents、搜索、置顶 | 未读、分组、操作 | 基础 Recent | 搜索、置顶、标签、未读、归档、恢复 |
| Projects | 文件、指令、记忆 | 本地文件、上下文、记忆 | Schema 有、产品面缺 | 完整 Project 生命周期与项目记忆 |
| Progress | Work 任务过程 | 右侧稳定进度 | 基础 Inspector | 可验证计划、阻塞、审批和恢复点 |
| Artifacts | Canvas、文档、表格、演示、Sites | Live Artifacts | 基本无 | 版本化 Artifact 工作台 |
| Code | Codex、Diff、PR | Claude Code | worktree/PTY/基础 Diff | Review-first Build 工作台 |
| 桌面入口 | 快捷窗口、截图、语音、录音 | Computer Use、Dispatch | 无 | Quick Pi、截图、通知、深链、菜单栏 |
| 自动化 | Scheduled/triggered Work | Scheduled tasks | Routines 表未落地 | 本地调度、监控、权限快照、通知 |
| 插件 | Apps、MCP、插件目录 | Skills/Connectors/Plugins | Pi 扩展市场较强 | 统一生态目录 + 安全沙箱 + MCP |
| 模型 | 托管模型 | 托管模型 | 自定义端点/模型发现 | 路由、故障转移、预算、本地模型 |
| 权限 | 写操作确认 | 明确工具权限 | Broker 已有 | 可解释策略、权限回放和审计 |
| 恢复 | 云端任务与历史 | 任务历史 | 本地 Event Store | Crash-safe checkpoint 与一键恢复 |
| 隐私 | 账户与云策略 | 本地/云边界 | 本地优先 | 用户可验证的数据流和零秘密日志 |
| 国际化 | 成熟 | 成熟 | 中英文基础 | 全量 i18n、术语表、布局与 VoiceOver |

---

## 7. 领先性功能

### 7.1 Endpoint Fabric

这是 Pi 必须明显领先竞品的第一能力：

- 支持 OpenAI Compatible、Anthropic Compatible 和 Pi 原生适配；
- 输入 URL 与 Key 后自动发现模型、能力和上下文窗口；
- 端点健康检查、延迟、限流、错误率和最近状态可视化；
- 支持模型别名、路由组、优先级、故障转移和按任务固定；
- 支持最大费用、最大 Token、超时和并发预算；
- 本地模型与离线端点显示隐私标识；
- 诊断页可复制脱敏报告，不泄露 Key、Header 和 Prompt。

领先指标：

- 新增兼容端点到第一次成功对话不超过 90 秒；
- 端点失败时 10 秒内给出可理解诊断；
- 路由切换不丢任务上下文；
- 100% Secret 只存在 Keychain 或进程内短生命周期内存。

### 7.2 Trusted Execution Ledger

每个任务都有可导出的执行账本：

- 哪个模型在何时提出了什么工具调用；
- 用户、策略或自动规则如何授权；
- 读取、修改、执行、联网分别影响了什么；
- 命令退出码、文件哈希、Diff 和测试结果；
- 扩展版本、端点、模型、Pi-Agent 版本和工作区快照；
- 任务恢复、回滚和导出。

这不是展示隐藏思维链，而是记录可验证外部动作和产品状态。

### 7.3 Extension Safety Center

- 官方与第三方源分层展示；
- 安装前显示能力、入口、版本、发布者、扫描结果和风险；
- 不执行 lifecycle scripts；
- 内容寻址的不可变快照；
- 每个扩展独立 Worker、权限与资源上限；
- 自动更新默认分批，失败自动回滚；
- 显示扩展实际调用记录和最近错误；
- 支持本地开发扩展的热重载，但必须标记 Developer Mode。

### 7.4 Project Time Machine

- Event Store、文件哈希、Git 状态、Artifact 版本和权限状态形成 Checkpoint；
- 用户可以回到任一“任务开始前”“授权前”“批量修改后”“测试通过后”节点；
- Git 项目优先使用 worktree/commit 恢复；
- 非 Git 项目使用受控快照，明确存储成本；
- 恢复前预览影响，恢复本身也产生可撤销记录。

### 7.5 One Task, Many Surfaces

同一 Task 可在 Chat、Canvas、Diff、Terminal、Preview、Artifact 之间切换：

- 状态与选择保持一致；
- 每个 Surface 只消费统一 Task Projection；
- 用户在 Canvas 的局部编辑、Build 的代码修改和 Timeline 的消息都归入同一任务；
- 不创建互相失联的“聊天会话”“编辑文档”“代码任务”。

---

## 8. 目标架构

### 8.1 进程边界

```text
Pi Desktop.app
├── Window/UI Layer
│   ├── Main Window
│   ├── Quick Pi Window
│   ├── Settings Window/Sheet
│   └── Artifact/Preview Window
├── React Product Kernel
│   ├── Typed Router
│   ├── Command Bus
│   ├── Task Projection Store
│   ├── Pane Registry
│   └── Design System
├── Rust/Tauri Core
│   ├── Repository + Event Store
│   ├── Task/Project/Artifact/Automation Services
│   ├── Capability Broker + Audit Ledger
│   ├── Endpoint Router
│   ├── Extension/Connector Supervisor
│   ├── Notification/Shortcut/Deep Link
│   └── Update/Backup/Diagnostics
└── Bundled Runtime
    ├── Pi Host Coordinator
    ├── One Pi Worker per active task
    ├── Extension Workers
    └── Preview/Artifact sandboxes
```

### 8.2 不可违反的边界

- Pi-Agent 是唯一 Agent Loop；React 和 Rust 不实现第二套模型循环；
- UI 不直接持有 Secret、不直接启动进程、不直接访问任意文件；
- 所有外部副作用经过 Capability Broker；
- UI 状态通过 Command → Event → Projection 更新，不用本地布尔值伪造运行态；
- Artifact、Preview、Extension 使用独立 CSP 与进程/资源边界；
- 自动化运行必须绑定固定权限快照，权限扩张需重新确认。

### 8.3 前端目录目标

```text
apps/desktop/src/
├── app/
│   ├── AppKernel.tsx
│   ├── routes.ts
│   ├── commands.ts
│   ├── projections.ts
│   └── windowRegistry.ts
├── design-system/
│   ├── tokens/
│   ├── primitives/
│   ├── patterns/
│   └── fixtures/
├── features/
│   ├── ask/
│   ├── tasks/
│   ├── projects/
│   ├── artifacts/
│   ├── automations/
│   ├── library/
│   ├── build/
│   ├── endpoints/
│   ├── extensions/
│   ├── connectors/
│   └── settings/
├── panes/
│   ├── timeline/
│   ├── progress/
│   ├── files/
│   ├── diff/
│   ├── terminal/
│   ├── canvas/
│   └── preview/
└── test/
```

### 8.4 Rust 目录目标

```text
apps/desktop/src-tauri/src/
├── commands/
├── domain/
│   ├── projects/
│   ├── tasks/
│   ├── artifacts/
│   ├── automations/
│   ├── endpoints/
│   └── extensions/
├── projections/
├── platform/
│   ├── keychain/
│   ├── notifications/
│   ├── shortcuts/
│   ├── deep_links/
│   ├── windows/
│   └── updater/
├── security/
│   ├── broker/
│   ├── policy/
│   ├── audit/
│   └── sandbox/
└── diagnostics/
```

---

## 9. 工作流规格

### 9.1 首次启动

1. 选择语言和外观；
2. 选择“使用内置推荐端点”“添加 API 端点”或“连接本地模型”；
3. 添加端点时即时校验 URL、保存 Key、发现模型；
4. 选择默认模型并完成一次脱敏连接测试；
5. 可跳过扩展，不强迫首次安装；
6. 进入 New Task，并提供 3 个真实可执行示例；
7. 首次工具执行时解释权限，不在 onboarding 中堆满安全术语。

验收：新用户 3 分钟内完成第一次有效回复；错误 Key、URL、无模型列表均有针对性恢复。

### 9.2 新建 Build 任务

1. 选择或拖入仓库；
2. 展示当前分支、未提交修改和隔离建议；
3. 默认新建 worktree，用户可明确选择当前目录；
4. 输入目标，选择模型、权限和扩展配置；
5. Task 创建成功后才进入 Running；
6. Progress 自动显示可验证步骤；
7. 修改后自动进入 Diff Review，测试证据绑定对应变更；
8. 用户决定继续、回滚、提交或导出补丁。

### 9.3 创建 Artifact

1. 在 Work 模式描述成品目标；
2. Pi 生成计划、引用来源和 Artifact 类型；
3. 右侧显示来源、进度与版本；
4. 中央 Canvas 支持选区修改和直接编辑；
5. 每次 AI 修改产生可比较版本；
6. 导出前运行格式、链接、可访问性和内容完整性检查；
7. 导出 PDF/DOCX/XLSX/PPTX/HTML 或项目包。

### 9.4 自动化

1. 从完成任务生成 Routine；
2. 固化 Prompt、输入、端点、模型、扩展和权限；
3. 选择一次、重复、文件变化或 Webhook 触发；
4. 显示下一次运行和资源预算；
5. 失败通知必须含恢复入口；
6. 权限或扩展版本变化时暂停并要求重新确认。

---

## 10. 实施任务

工作量以“工程人日”为单位，包含实现、测试和评审，不含产品等待时间。

### 10.1 Foundation：停止继续累积前端债务

| ID | 任务 | 依赖 | 工作量 | 主要文件 | 验收 | 回滚 |
|---|---|---|---:|---|---|---|
| FND-001 | 建立 typed route 与 App Kernel | 无 | 5 | `app/AppKernel.tsx`, `app/routes.ts`, `App.tsx` | Tasks/Settings 行为不变，路由可深链 | 保留旧入口 feature flag |
| FND-002 | 建立 Task Projection Store | FND-001 | 8 | `app/projections.ts`, `bridge`, Rust events | UI 运行态全部可追溯到事件 | 双读旧状态一版 |
| FND-003 | 建立 Command Bus 与错误分类 | FND-001 | 5 | `app/commands.ts`, `bridge/index.ts` | 发送、停止、重试、审批统一返回类型 | adapter 回退现有 invoke |
| FND-004 | 建立 Design Token 与 Primitive | 无 | 8 | `design-system/*` | 无字号低于 11 px；明暗/中英/高对比通过 | tokens 可切回 legacy theme |
| FND-005 | 拆分 4,100 行全局样式 | FND-004 | 10 | `styles.css`, feature styles | 无重复全局覆盖；CSS 预算和 lint 通过 | 分页面 feature flag |
| FND-006 | 引入前端测试基座 | 无 | 5 | `vitest.config`, `test/*`, package scripts | 核心组件与状态机可在 CI 运行 | 不影响生产构建 |

### 10.2 Shell 与导航

| ID | 任务 | 依赖 | 工作量 | 主要文件 | 验收 | 回滚 |
|---|---|---|---:|---|---|---|
| UX-001 | Ask/Work/Build 模式切换 | FND-001/002 | 5 | `app/routes.ts`, `features/*` | 切换不丢 Task/草稿/选择 | 隐藏模式开关 |
| UX-002 | 新侧栏与 Recents | FND-004 | 7 | `AppSidebar.tsx`, task repository | 置顶、未读、归档、分组、搜索可用 | 保留旧 sidebar |
| UX-003 | 统一 Toolbar/Breadcrumb | FND-004 | 4 | `patterns/TaskToolbar.tsx` | 重命名、更多菜单、模式状态一致 | 旧 toolbar adapter |
| UX-004 | 响应式三栏与 Pane Registry | FND-001/004 | 8 | `windowRegistry.ts`, `panes/*` | 760/1100/1600 三档无遮挡 | 固定旧布局 |
| UX-005 | 统一 Settings | FND-001/004 | 8 | `features/settings/*` | 搜索、分组、保存态、键盘与中英完整 | 保留旧 section |
| UX-006 | 全局命令面板 | FND-003 | 5 | `features/commands/*` | Cmd+K 可发现所有核心动作 | 设置关闭 |

### 10.3 会话与任务体验

| ID | 任务 | 依赖 | 工作量 | 验收 |
|---|---|---|---:|---|
| SES-001 | Composer 状态机重构 | FND-002/003/004 | 8 | IME、草稿、附件、提交确认、失败恢复全覆盖 |
| SES-002 | Timeline 虚拟化与滚动锚点 | FND-002 | 7 | 10,000 事件、流式输出、向上阅读无跳动 |
| SES-003 | Tool Group 与结果摘要 | FND-002 | 6 | 同类工具按语义分组，可展开耗时/影响/错误 |
| SES-004 | 消息编辑、重试、分支 | FND-003 | 7 | 分支保留来源，旧会话不被覆盖 |
| SES-005 | Progress/Context/Memory Inspector | UX-004 | 8 | 计划、上下文、文件、权限均来自 Projection |
| SES-006 | 任务搜索、标签、归档、恢复 | UX-002 | 6 | 全文检索、过滤和误删恢复可用 |
| SES-007 | Crash Checkpoint | FND-002 | 8 | App/WebView/Worker 崩溃后可恢复草稿与任务 |

### 10.4 Projects 与 Build

| ID | 任务 | 依赖 | 工作量 | 验收 |
|---|---|---|---:|---|
| PRJ-001 | Project Repository/IPC/UI | FND-001/002 | 10 | 新建、导入、编辑指令、文件、记忆、删除恢复闭环 |
| PRJ-002 | Project Overview | PRJ-001 | 6 | 活动任务、分支、Artifacts、资源和健康状态可见 |
| DEV-001 | File Tree/Search/Problems | UX-004 | 10 | 大仓库异步加载、忽略规则、搜索取消和错误状态 |
| DEV-002 | 生产级 Diff Review | DEV-001 | 10 | unified/split、hunk、二进制、重命名、暂存前审查 |
| DEV-003 | Terminal 任务归因 | FND-002 | 6 | 命令、退出码和输出与 Task/Tool Call 绑定 |
| DEV-004 | Preview 与端口管理 | DEV-001 | 10 | 端口发现、预览、重载、停止、CSP 和网络权限 |
| DEV-005 | Test Evidence | DEV-002/003 | 6 | 测试命令、结果和变更版本绑定 |
| DEV-006 | Checkpoint/Time Machine | SES-007/DEV-002 | 12 | Git 与非 Git 恢复均可预览、执行和撤销 |

### 10.5 Artifacts 与多模态

| ID | 任务 | 依赖 | 工作量 | 验收 |
|---|---|---|---:|---|
| ART-001 | Artifact 数据模型与版本 | FND-002 | 8 | 类型、版本、来源、导出、删除恢复完整 |
| ART-002 | Canvas 文本编辑 | ART-001/UX-004 | 10 | 直接编辑、局部 AI 修改、Diff、版本恢复 |
| ART-003 | Preview Sandbox | ART-001/DEV-004 | 8 | HTML/SVG/React 预览隔离且无任意主进程能力 |
| ART-004 | 文档/表格/演示导出 | ART-001 | 15 | DOCX/XLSX/PPTX/PDF 生成、预览和打开可用 |
| ART-005 | Screenshot/Clipboard | UX-004 | 5 | 系统选择、权限拒绝、隐私提示和附件恢复 |
| ART-006 | Voice/Record 基础 | SES-001 | 10 | 明示录音、设备选择、转写、停止和删除 |

### 10.6 端点、路由与生态

| ID | 任务 | 依赖 | 工作量 | 验收 |
|---|---|---|---:|---|
| END-001 | Endpoint 向导与诊断 | FND-004 | 6 | URL/Key/模型发现/错误恢复 90 秒内完成 |
| END-002 | Route Group 与故障转移 | END-001 | 10 | 固定任务模型、熔断、重试、切换事件可审计 |
| END-003 | 费用/Token/并发预算 | END-002 | 7 | 软硬预算、预警和阻止行为可测试 |
| END-004 | 本地模型配置 | END-001 | 6 | Ollama/MLX/OpenAI compatible 可自动发现 |
| ECO-001 | 统一 Extension/Skill/Prompt/Theme 目录 | FND-004 | 10 | 搜索、筛选、详情、安装、更新、回滚一致 |
| ECO-002 | MCP/Connector Runtime | FND-003 | 15 | OAuth/本地连接、权限、读写确认、断开和审计 |
| ECO-003 | 扩展资源配额与健康页 | ECO-001 | 8 | CPU/内存/错误/调用/版本可见，可单独禁用 |
| ECO-004 | 开发者扩展工作流 | ECO-001 | 6 | 本地加载、热重载、明确风险标记和日志 |

### 10.7 Automations 与桌面原生

| ID | 任务 | 依赖 | 工作量 | 验收 |
|---|---|---|---:|---|
| AUT-001 | Routine Repository/IPC/UI | FND-002 | 10 | 一次/重复任务、启停、运行历史完整 |
| AUT-002 | 权限与版本快照 | AUT-001/ECO-001 | 6 | 权限或扩展变化时自动暂停并重新确认 |
| AUT-003 | 触发器与监控 | AUT-001 | 10 | 时间、文件变化、Webhook 触发且可去重 |
| DES-001 | Quick Pi Window | UX-004/SES-001 | 8 | Option+Space、自定义快捷键、多屏和焦点正确 |
| DES-002 | 通知与完成跳转 | AUT-001 | 5 | 点击定位任务；勿扰和权限拒绝可恢复 |
| DES-003 | Deep Link 与单实例 | FND-001 | 5 | `pi://task/...` 安全解析且不重复启动 |
| DES-004 | 窗口状态与多窗口 | UX-004 | 6 | 恢复尺寸、屏幕变化、独立 Artifact 窗口 |
| DES-005 | 菜单、分享与服务 | DES-003 | 5 | 原生菜单、最近项目、系统分享与键盘帮助 |

### 10.8 安全、质量与发布

| ID | 任务 | 依赖 | 工作量 | 验收 |
|---|---|---|---:|---|
| SEC-001 | 威胁模型与权限矩阵 | 无 | 6 | 文件、Shell、网络、扩展、连接器、预览边界成文并测试 |
| SEC-002 | Audit Ledger 导出 | FND-002/SEC-001 | 8 | 脱敏、人类可读、机器可读、哈希可验证 |
| SEC-003 | 路径/符号链接/TOCTOU 测试 | SEC-001 | 7 | 越界与竞态测试全部阻断 |
| SEC-004 | Secret 与日志审计 | SEC-001 | 5 | Key/Authorization/Prompt 不进入普通日志 |
| QLT-001 | UI 组件与状态测试 | FND-006 | 10 | 核心组件分支覆盖率 ≥ 85% |
| QLT-002 | GUI E2E | FND-006 | 12 | 20 条 P0 用户旅程在干净用户目录重复通过 |
| QLT-003 | 视觉回归 | FND-004 | 7 | 主题×语言×尺寸×状态截图门禁 |
| QLT-004 | 性能与长稳测试 | SES-002 | 8 | 启动、内存、10k 事件、8 小时任务达到预算 |
| QLT-005 | VoiceOver/键盘审计 | FND-004 | 8 | 核心流程无需鼠标，AX 名称/顺序/焦点正确 |
| REL-001 | Universal 构建 | 无 | 7 | arm64/x86_64 均能启动并完成核心任务 |
| REL-002 | 签名与公证 | REL-001/SEC-004 | 5 | Gatekeeper 验证通过，无 adhoc 依赖 |
| REL-003 | 自动更新与回滚 | REL-002 | 8 | 断网/损坏/降级/数据迁移测试通过 |
| REL-004 | Crash/Diagnostics | SEC-004 | 6 | 默认本地、用户同意上传、报告脱敏 |
| REL-005 | Release Candidate 门禁 | 全部 P0 | 5 | 第 14 节所有门禁通过才可发布 |

---

## 11. 第一轮 10 个工作日实施顺序

这十天不追求“看起来又多了几个功能”，目标是消除继续开发的结构性阻力。

### 第 1–2 天

- 完成 FND-006 测试基座；
- 为输入、IME、发送、失败恢复、任务重连建立回归测试；
- 记录现有主流程行为，防止重构改变运行语义。

### 第 3–4 天

- 完成 FND-001 typed route 与 App Kernel；
- 将 App 启动、任务恢复、Settings 打开从 `App.tsx` 移出；
- 用 feature flag 保留旧工作台。

### 第 5–6 天

- 完成 FND-004 Design Token 第一版；
- 建立 Button、Field、Dialog、SidebarItem、StatusBadge；
- 全局禁止新增低于 11 px 的 UI 字号。

### 第 7–8 天

- 完成 SES-001 Composer 状态机；
- 覆盖中文 IME、附件、首次会话、断连、取消、重复发送；
- UI 显示 `Submitting / Sent / Failed` 真实状态。

### 第 9–10 天

- 完成 UX-002 新侧栏骨架与 UX-005 Settings 骨架；
- 将 Projects、Artifacts、Automations 作为真实 disabled/preview route，不制作假页面；
- 产出浅色/深色、中/英、760/1100/1600 px 截图基线。

十日退出条件：

- 新功能没有继续堆入旧 `App.tsx`；
- 核心输入/发送回归测试全部通过；
- UI 不再新增低于 11 px 文本；
- 新旧工作台可通过 feature flag 切换；
- 可开始并行开发 Projects、Artifacts、Build Pane。

---

## 12. 阶段、资源与里程碑

### 12.1 推荐团队

- 1 名 macOS/Tauri/Rust 工程师；
- 2 名前端/产品工程师，其中 1 人负责 Design System 与可访问性；
- 1 名 Pi Runtime/安全工程师；
- 0.5 名产品设计；
- 0.5 名 QA/Release。

### 12.2 现实工期

| 阶段 | 周期 | 目标 | 退出标准 |
|---|---:|---|---|
| Phase 0：基础重构 | 2 周 | App Kernel、Projection、Design System、测试基座 | 十日退出条件全部通过 |
| Phase 1：可信 Beta | 4 周 | Shell、Composer、Timeline、Projects、Build Review | P0 对话/代码任务稳定 |
| Phase 2：桌面对标 | 5 周 | Artifacts、Quick Pi、通知、完整 Settings、MCP | 基础桌面能力覆盖率 ≥ 90% |
| Phase 3：形成领先 | 5 周 | Endpoint Fabric、Audit Ledger、Time Machine、Automations | 六项差异化指标通过 |
| Phase 4：发布硬化 | 4 周 | 安全、性能、可访问性、签名、公证、更新 | RC 门禁全部通过 |

推荐团队约 20 周。单人全职实现的合理预算为 12–18 个人月，不能用牺牲测试、签名或无障碍来压缩为几周。

### 12.3 发布层级

- **Engineering Alpha**：当前；
- **Private Beta**：Phase 1 完成，仅邀请测试；
- **Public Beta**：Phase 2 完成，签名公证且数据迁移稳定；
- **Release Candidate**：Phase 3 完成，无 P0/P1 已知问题；
- **1.0**：Phase 4 和用户基准测试通过。

---

## 13. 测试策略

### 13.1 测试金字塔

| 层级 | 范围 | 主要工具 | 门禁 |
|---|---|---|---|
| Unit | reducer、状态机、解析、策略、Repository | Vitest/Rust test | 每次提交 |
| Component | Composer、Timeline、Dialog、Settings | Testing Library | 每次提交 |
| Contract | React bridge ↔ Tauri ↔ Pi Host | schema fixtures | 每次提交 |
| Integration | SQLite、Keychain、Worker、Endpoint、Extension | Rust/Node integration | PR |
| GUI E2E | 真实窗口、输入、发送、重启、权限、更新 | macOS runner | PR/nightly |
| Visual | 主题、语言、尺寸、空/错/载入/长文本 | screenshot diff | PR |
| Performance | 启动、内存、长任务、长列表 | benchmark harness | nightly/RC |
| Security | 路径、Secret、CSP、扩展、更新签名 | adversarial suite | nightly/RC |

### 13.2 P0 GUI 用户旅程

至少覆盖：

1. 首次启动添加 Endpoint、输入 Key、发现模型并发送；
2. 中文 IME 输入、换行、发送；
3. Host 未启动时首次发送；
4. 发送中断后恢复草稿和附件；
5. 切换任务后回来继续输入；
6. 重启 App 后恢复历史和运行任务；
7. Worker 崩溃后重连；
8. 创建 Project 与 Build worktree；
9. 修改文件、审查 Diff、运行测试、回滚；
10. 安装、启用、升级、失败回滚扩展；
11. Key 错误、Endpoint 超时、模型下线；
12. 权限允许一次、始终允许、拒绝；
13. Quick Pi 到主窗口接力；
14. 创建 Artifact、局部修改、版本恢复、导出；
15. 自动化运行、失败通知、重新授权；
16. 自动更新损坏包回滚；
17. 中英文和浅色/深色切换；
18. VoiceOver 完成新建与发送；
19. 小窗口 760 px 完成核心任务；
20. 10,000 事件任务滚动和搜索。

---

## 14. 正式发布质量门禁

### 14.1 功能与可靠性

- P0 E2E 100% 通过，连续 20 次无偶发失败；
- P1 通过率 ≥ 98%，无数据丢失问题；
- App、WebView、Pi Host、Worker 任一崩溃后任务可恢复；
- 运行中退出 App 不破坏工作树和数据库；
- 自动更新失败保持旧版本可用；
- 数据迁移可前向验证，并保留兼容回滚窗口。

### 14.2 性能预算

| 指标 | 目标 |
|---|---:|
| 冷启动到可输入 p50 / p95 | ≤ 1.8 s / ≤ 3.0 s |
| 历史任务打开 p95 | ≤ 2.0 s |
| Composer 输入响应 | 99% 帧 ≤ 16 ms |
| 点击发送到本地受理反馈 | ≤ 100 ms |
| 10,000 事件滚动 | ≥ 55 fps |
| 空闲主应用内存 | ≤ 300 MB |
| 单活跃 Worker 推荐预算 | ≤ 250 MB，不含模型服务 |
| 8 小时稳定任务 | 无持续性内存增长，峰值后可回落 |

### 14.3 UI/UX

- 所有正文与控制标签字号 ≥ 11 px；
- 760/1100/1600 px 无遮挡、溢出和不可达控制；
- 浅色、深色、高对比、中英文、Reduced Motion/Transparency 全覆盖；
- 空态、载入、失败、离线、无权限、运行中、完成状态均有设计；
- 首次用户不依赖文档完成 Endpoint 添加与第一次发送；
- 关键动作不使用只有图标且无 Tooltip/AX Label 的控件。

### 14.4 可访问性

- 核心流程 100% 可通过键盘完成；
- VoiceOver 阅读顺序与视觉顺序一致；
- Modal/Popover 焦点锁定和返回正确；
- WCAG AA 对比度；
- 200% 文本缩放不丢功能；
- 动效、透明、颜色和声音均有系统偏好回退。

### 14.5 安全与隐私

- Secret 只在 Keychain 与短生命周期内存；
- 日志、Crash Report、Audit 导出默认脱敏；
- Extension、Preview、Connector、Shell 权限边界通过威胁测试；
- 更新包签名、哈希和发布通道验证；
- 生成 SBOM，依赖漏洞无未处置 Critical/High；
- 用户可查看、导出和删除本地数据；
- Computer Use、录音和连接器写操作必须明示并可中止。

### 14.6 分发

- arm64 与 x86_64 Universal；
- Developer ID 签名与 Apple Notarization；
- 干净 macOS 用户账户安装、升级、卸载验证；
- 自动更新支持 stable/beta 通道和失败回滚；
- `.app`、DMG、版本信息、图标和权限文案一致；
- Release Note、隐私说明、诊断入口与支持包齐全。

---

## 15. 用户研究与领先指标

正式 RC 前进行两轮可用性测试，每轮至少 5 名目标用户。

### 15.1 基准任务

- 添加自定义端点并开始对话；
- 在已有仓库修复一个带测试的缺陷；
- 从任务生成一份可导出的技术报告；
- 安装一个扩展并理解其权限；
- 从失败任务恢复；
- 创建一个每天执行的监控任务。

### 15.2 指标

| 指标 | 目标 |
|---|---:|
| 无帮助任务成功率 | ≥ 95% |
| 第一次有效回复时间 | ≤ 3 分钟 |
| Build 任务正确完成率 | ≥ 90% |
| 用户能正确解释当前模型/权限/影响范围 | ≥ 90% |
| 失败后自主恢复率 | ≥ 90% |
| 与竞品组合流程相比的中位耗时 | 至少缩短 20% |
| SUS | ≥ 85 |
| “我信任它修改本地项目”同意度 | ≥ 80% |

### 15.3 不可接受的领先方式

- 通过默认扩大权限换取更少确认；
- 隐藏失败、费用、路由或扩展风险；
- 用不可验证的“AI 更聪明”作为产品指标；
- 复制竞品商标、图标、文案或精确视觉资产；
- 牺牲键盘、VoiceOver、中英文或低配设备体验。

---

## 16. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 | 回滚 |
|---|---:|---:|---|---|
| 前端重构破坏发送链路 | 中 | 高 | 先建状态与契约测试，双工作台开关 | 切回 legacy shell |
| Event Projection 与 Runtime 漂移 | 中 | 高 | 单调事件序号、snapshot 校验、重放测试 | 重建 projection |
| Artifact 范围膨胀 | 高 | 高 | 先文本 Canvas 和 HTML Preview，再扩格式 | 关闭未成熟导出类型 |
| MCP/Connector 扩大攻击面 | 高 | 高 | 独立权限、OAuth 隔离、写操作确认 | 全局禁用 connector runtime |
| 自动化后台越权 | 中 | 高 | 固定权限快照、过期重授权 | 暂停全部 routine |
| Extension 更新导致任务失败 | 中 | 中 | 内容寻址、分批更新、健康检查 | 原子切回旧快照 |
| Universal/公证延误 | 中 | 高 | Phase 1 即建立签名预流水线 | 延后 Public Beta，不降级为 adhoc |
| CSS 迁移视觉反复 | 高 | 中 | Token、Fixture、截图回归 | 按页面使用 legacy theme |
| 本地数据迁移损坏 | 低 | 极高 | 备份、事务、前后校验、旧版本只读 | 恢复备份并回退 App |
| 模型端点差异过大 | 高 | 中 | 能力探测、兼容层、明确降级 | 固定已验证能力配置 |
| 团队资源不足 | 高 | 高 | 严格发布层级与非目标 | 减少 P1，不删除 P0 门禁 |

---

## 17. 1.0 范围边界

### 17.1 1.0 必须完成

- Ask/Work/Build 统一任务系统；
- Projects、Recents、Search、Progress、Context；
- 完整 Composer、Timeline、Diff、Terminal、Preview；
- 文本 Canvas 与至少 HTML/PDF 一类可靠成品导出；
- Endpoint Fabric 基础路由和诊断；
- Pi 扩展安全中心与 MCP 基础；
- Quick Pi、通知、深链、窗口恢复；
- Crash 恢复、Audit Ledger；
- Universal、签名、公证、自动更新；
- 中英文、键盘、VoiceOver 和视觉回归。

### 17.2 1.0 可以延后但不得伪装完成

- 跨设备云同步与手机 Dispatch；
- 多人实时协作；
- 全功能表格和演示编辑器；
- 视频生成与高级音视频工作台；
- 通用 Computer Use；
- 企业 SSO、组织策略与集中审计；
- Windows/Linux 版本。

延后功能可以显示 Roadmap，但不得放置无实际功能的可点击入口。

---

## 18. 官方资料

### OpenAI

- New ChatGPT desktop app: <https://help.openai.com/en/articles/20001276>
- ChatGPT Work and Codex: <https://help.openai.com/en/articles/20001275/>
- ChatGPT release notes: <https://help.openai.com/en/articles/6825453-how-chatgpt-and-other-ai-writing-tools-work>
- Desktop app release notes: <https://help.openai.com/en/articles/9703738-desktop-app-release-notes>
- Canvas: <https://help.openai.com/en/articles/9930697-what-is-canvas>
- Projects: <https://help.openai.com/en/articles/10169521-projects-in-chatgpt>
- Apps and connectors: <https://help.openai.com/en/articles/11487775-connectors-in>
- ChatGPT Record: <https://help.openai.com/en/articles/11487532-chatgpt-record>
- Work documents, spreadsheets and presentations: <https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work>

### Anthropic

- Unified directory for skills, connectors and plugins: <https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory>
- Scheduled tasks: <https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork>
- Projects in Cowork: <https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork>
- Plugins: <https://support.claude.com/en/articles/13837440-use-plugins-in-claude>
- Computer use in Cowork: <https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork>
- Desktop and remote connectors: <https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors>
- Live Artifacts: <https://support.claude.com/en/articles/14729249-use-live-artifacts-in-claude-cowork>
- Dispatch: <https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork>

---

## 19. Definition of Done

一个功能只有同时满足以下条件才算“完成”：

1. 有真实后端或 Runtime 数据，不是静态占位；
2. 正常、空、载入、失败、离线、无权限、恢复状态完整；
3. 中英文、浅色、深色、键盘、VoiceOver 可用；
4. Unit/Component/Contract 测试存在；
5. P0 功能进入 GUI E2E；
6. 日志与错误不泄露 Secret；
7. 有迁移、关闭或回滚方案；
8. 文档与 Settings 中可发现；
9. 在 760/1100/1600 px 通过视觉检查；
10. 不在 `App.tsx` 或全局 CSS 中新增无法复用的业务补丁。

---

## 20. 立即决策

1. V3 成为后续正式交付的唯一总体基线；V2 保留为 Claude 对标阶段的历史设计参考。
2. 当前版本统一称为 Engineering Alpha，不再使用“接近正式版”措辞。
3. 下一开发迭代从 FND-006、FND-001、FND-004、SES-001 开始。
4. 在 Phase 0 完成前暂停大规模新增页面和视觉覆盖。
5. 任何“超越 ChatGPT/Claude”的发布宣称必须以第 14、15 节指标为证据。

