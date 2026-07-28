# VS Code Marketplace 发布信息

> 用于 VS Code Marketplace 扩展详情页的内容模板。

---

## 扩展基本信息

| 字段 | 值 |
| --- | --- |
| **名称** | Pi Code |
| **标识符** | `earendil-works-community.pi-code` |
| **描述** | The Pi coding agent (pi.dev) in VS Code — native chat panel, streaming responses, multi-session tabs, multi-model switching, and inline diff review. |
| **版本** | 0.1.0 |
| **发布者** | Earendil Works Community |
| **类别** | AI, Chat |
| **图标** | `resources/icon.png` (PNG), `resources/icon.svg` (SVG) |
| **VS Code 最低版本** | ^1.85.0 |
| **许可证** | MIT |

---

## 功能特性

- **原生聊天面板** — 基于 `pi` CLI 的原生 VS Code 聊天界面
- **多会话标签页** — 同时运行多个 Agent 会话，互不干扰
- **模型切换** — 在工具栏中随时切换不同模型
- **思考深度控制** — 调节 Agent 的推理可见程度
- **@-提及** — 在聊天中直接引用文件、符号、终端和问题
- **斜杠命令菜单** — 快速访问 22+ 个 Agent 命令
- **Diff 审阅** — 通过行内 Diff 装饰接受或拒绝代码修改
- **终端集成** — Agent 可直接在 VS Code 终端中执行命令
- **会话列表侧栏** — 统一管理所有会话
- **会话持久化** — 重启 VS Code 后自动恢复会话
- **键盘快捷键** — 聚焦输入框、新建会话、引用文件、停止任务等
- **扩展引导** — 4 步交互式新手引导
- **认证状态** — 状态栏显示登录/登出状态
- **主题适配** — 支持 Light、Dark、High Contrast 三种主题
- **流式渲染** — 实时显示模型响应，支持可折叠思考块
- **配置丰富** — 15+ 项可配置设置

---

## 安装要求 (Requirements)

- **pi CLI** — 必须单独安装 `pi` 命令行工具（参见 [pi.dev](https://pi.dev) 安装指南）
- **Node.js** >= 18
- **VS Code** ^1.85.0
- **支持的操作系统**：macOS (Apple Silicon + Intel)、Windows 11 x64、Ubuntu 24.04 x64
- **远程环境**：支持 Remote SSH、Dev Containers、WSL、Codespaces

---

## 扩展设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `pi.path` | `"pi"` | `pi` 可执行文件路径 |
| `pi.defaultProvider` | `""` | 默认 LLM Provider |
| `pi.defaultModel` | `""` | 默认模型 ID/模式 |
| `pi.sessionDir` | `""` | 会话文件存储目录 |
| `pi.maxConcurrentSessions` | `3` | 最大并发会话数（1-10） |
| `pi.enableTerminalIntegration` | `false` | 启用终端集成 |
| `pi.autoReconnect` | `true` | 崩溃后自动重启 |

完整设置列表参见 [README.md](README.md)。

---

## 隐私声明

> **最后更新：2026-07-27**

### 数据收集

- **Pi Code 默认不收集任何遥测数据。**
- 扩展不会向任何第三方服务器上传你的源代码、提示词、Diff 内容或命令输出。
- 所有与模型提供商的通信直接由 `pi` CLI 管理，扩展本身不存储 API 密钥。

### API 密钥

- API 密钥由 `pi` CLI 通过系统密钥链或 VS Code `SecretStorage` 管理。
- API 密钥**不会**以明文形式保存在 VS Code `settings.json`、日志文件或导出数据中。

### 源代码与提示词

- 你的源代码和提示词**仅**通过 `pi` CLI 发送到你配置的 LLM Provider。
- Pi Code 扩展不会将你的代码或提示词上传到任何遥测服务器。
- 默认遵守 `.gitignore` 规则，`.env`、密钥文件和构建产物不会发送给模型。

### 第三方服务

- 本扩展依赖 `pi` CLI 与 LLM Provider 通信。请查阅各 Provider 的隐私政策了解其数据处理方式。

### 安全审计

完整的 SECURITY.md 文档包含详细的安全控制和审计日志说明，参见 [SECURITY.md](SECURITY.md)。

---

## 支持与反馈

| 渠道 | 链接 |
| --- | --- |
| GitHub 仓库 | [github.com/earendil-works/pi-code](https://github.com/earendil-works/pi-code) |
| Issue 跟踪 | [github.com/earendil-works/pi-code/issues](https://github.com/earendil-works/pi-code/issues) |
| 官方主页 | [pi.dev](https://pi.dev) |
| 许可证 | MIT |

---

## Marketplace 图标

扩展图标文件位于 `resources/` 目录：

| 文件 | 用途 |
| --- | --- |
| `resources/icon.png` | Marketplace 列表图标（PNG 格式） |
| `resources/icon.svg` | Activity Bar 图标（SVG 格式） |

图标设计要求：

- 简洁、可识别的 Pi 品牌标识
- 在 VS Code 深色/浅色主题下均清晰可见
- SVGs 应包含 `fill="currentColor"` 以适配主题色

---

## 分类与标签

**Categories**: `AI`, `Chat`

**Tags**: `pi`, `coding agent`, `AI`, `chat`, `LLM`, `code generation`, `Claude`, `OpenAI`

---

*最后更新：2026-07-27*
