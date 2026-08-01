import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppLocale = "zh-CN" | "en-US";
export type AppTheme = "system" | "light" | "dark";

interface I18nContextValue {
  locale: AppLocale;
  theme: AppTheme;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: AppTheme) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
}

const localeStorageKey = "pi-desktop.locale";
const themeStorageKey = "pi-desktop.theme";

const zhCN: Record<string, string> = {
  "Desktop Agent": "桌面智能体",
  Agent: "智能体",
  Configure: "配置",
  "Collapse sidebar": "收起侧栏",
  "Expand sidebar": "展开侧栏",
  Search: "搜索",
  "Search settings": "搜索设置",
  "Close settings": "关闭设置",
  "Search or run a command": "搜索或运行命令",
  Workspace: "工作区",
  Layout: "布局",
  "Reset layout": "重置布局",
  Reset: "重置",
  "Chat + Inspector": "对话与审查",
  "Chat + Terminal": "对话与终端",
  "3-Pane": "三栏模式",
  "Chat only": "仅对话",
  Custom: "自定义",
  "Resize side panel": "调整侧边栏大小",
  "Resize terminal": "调整终端高度",
  Chat: "对话",
  Sessions: "任务",
  Session: "任务",
  Settings: "设置",
  "New task": "新建任务",
  Projects: "项目",
  "Projects keep local tasks, project files, and working context together.":
    "项目将本地任务、项目文件和工作上下文集中在一起。",
  "Open project folder": "打开项目文件夹",
  "Start with a local project": "从本地项目开始",
  "Choose a folder to create an isolated Pi task. Your project appears here after its first task is saved.":
    "选择一个文件夹来创建隔离的 Pi 任务。首个任务保存后，项目会显示在这里。",
  "Choose folder": "选择文件夹",
  "Use private scratch folder": "使用私有临时文件夹",
  "{count} active tasks": "{count} 个活动任务",
  "No recent activity": "暂无最近活动",
  "Open latest task": "打开最近任务",
  "Project list": "项目列表",
  "Search projects": "搜索项目",
  "No matching projects": "没有匹配的项目",
  "Tasks in {name}": "{name} 中的任务",
  "Recent tasks": "最近任务",
  "No active tasks in this project": "该项目中没有活动任务",
  "Project instructions": "项目指令",
  "Applied to every new and restored Pi task in this project. Stored locally and visible here.":
    "会应用到此项目中新建和恢复的每个 Pi 任务。仅本地保存，并始终在此可见。",
  Save: "保存",
  "Example: use the existing patterns, run the relevant tests, and explain any tradeoffs.":
    "示例：沿用现有模式，运行相关测试，并说明取舍。",
  "Just now": "刚刚",
  "{count} min ago": "{count} 分钟前",
  "{count} hr ago": "{count} 小时前",
  "{count} days ago": "{count} 天前",
  Recents: "最近任务",
  "Search tasks": "搜索任务",
  "No matching tasks": "没有匹配的任务",
  "New session": "新建任务",
  "New local task": "新建本地任务",
  "Choose a project folder": "选择项目文件夹",
  "Pi is ready": "Pi 已就绪",
  "Restart runtime": "重启运行时",
  "Runtime error": "运行时错误",
  Dismiss: "关闭",
  General: "通用",
  "Models & API": "模型与 API",
  "Extensions & updates": "扩展与更新",
  Runtime: "运行时",
  Language: "界面语言",
  Appearance: "外观",
  "Use the language that feels most natural for directing Pi.":
    "选择你最习惯的界面语言来指挥 Pi。",
  Notifications: "通知",
  "Notify when a task completes, fails, or waits; the Dock badge shows pending tasks.":
    "任务完成、失败或等待时发送系统通知；Dock 徽标显示待处理任务数。",
  "Task completed": "任务已完成",
  "Task failed": "任务失败",
  "Task waiting": "任务等待中",
  "Pi Task": "Pi 任务",
  "Quick Entry": "快速发起",
  "Describe what you want Pi to do…": "描述你要 Pi 完成的事…",
  Screenshot: "截图",
  Submit: "提交",
  "Screen Recording is not authorized": "未授予屏幕录制权限",
  "Follow system": "跟随系统",
  Light: "浅色",
  Dark: "深色",
  Chinese: "中文",
  English: "English",
  "App preferences": "应用偏好",
  "Preferences are saved locally on this Mac.": "偏好设置仅保存在这台 Mac 上。",
  "Local-first workspace": "本地优先工作区",
  "Tasks, endpoint profiles, and extension snapshots stay on this Mac unless an API request explicitly sends task context to your selected provider.":
    "任务、端点配置和扩展快照默认保留在本机；只有发起 API 请求时，任务上下文才会发送给你选择的模型服务商。",
  "Pi runtime status": "Pi 运行时状态",
  Ready: "已就绪",
  Starting: "正在启动",
  Stopped: "已停止",
  Error: "错误",
  Idle: "空闲",
  "Restart the isolated Pi coordinator and reconnect saved sessions.":
    "重启隔离的 Pi 协调器，并重新连接已保存的任务。",
  "Application data": "应用数据",
  "Schema version": "数据架构版本",
  "Imported records": "已导入记录",
  "Open settings": "打开设置",
  "Manage models, extensions, runtime, language, and appearance":
    "统一管理模型、扩展、运行时、语言和外观",
  "Open sessions": "打开任务",
  "Return to the active agent conversation": "返回当前智能体任务",
  "Choose a project and start an isolated Pi session":
    "选择项目并启动隔离的 Pi 任务",
  "Manage API endpoints": "管理 API 端点",
  "Add, test, and select custom model providers": "添加、测试并选择自定义模型服务",
  "Manage Pi resources": "管理 Pi 资源",
  "Browse, review, update, and approve Pi extensions":
    "浏览、审查、更新并批准 Pi 扩展",
  "Open the native macOS folder picker": "打开 macOS 文件夹选择器",
  "Create a new task first to choose another project":
    "请先新建任务，再选择其他项目",
  "Restart Pi runtime": "重启 Pi 运行时",
  "Restart the coordinator and safely reconnect tasks":
    "重启协调器并安全重连任务",
  "Command palette": "命令面板",
  "Type a command or search…": "输入命令或搜索…",
  "Search commands": "搜索命令",
  "No matching command": "没有匹配的命令",
  "↑↓ Navigate": "↑↓ 导航",
  "↵ Run": "↵ 运行",
  "esc Close": "esc 关闭",
  "What would you like Pi to work on?": "你想让 Pi 完成什么？",
  "What can Pi take off your plate?": "有什么任务可以交给 Pi？",
  "Choose a project or folder, describe the outcome, and Pi will keep going until the task is done.":
    "选择项目或文件夹，描述期望结果，Pi 会持续推进直到任务完成。",
  "Choose a local project, describe the outcome, and Pi will create the session when you send.":
    "选择一个本地项目并描述预期结果，发送时 Pi 会自动创建任务。",
  "Project folder": "项目文件夹",
  "Work in a project or folder": "在项目或文件夹中工作",
  "Choose a local folder…": "选择本地文件夹…",
  "Browse…": "浏览…",
  Isolation: "隔离方式",
  "New worktree (recommended)": "新建 worktree（推荐）",
  "Current checkout": "当前检出目录",
  "Read-only project": "只读项目",
  "Checking repository…": "正在检查仓库…",
  "Not a Git repository · worktree unavailable":
    "不是 Git 仓库 · 无法使用 worktree",
  "Git projects use an isolated worktree by default":
    "Git 项目默认使用隔离 worktree",
  Prompt: "提示词",
  "Describe what you want Pi to accomplish…": "描述你希望 Pi 完成的任务…",
  "Ask Pi to build, review, explain, or fix…":
    "让 Pi 构建、审查、解释或修复…",
  "Restoring this session…": "正在恢复此任务…",
  "Attach files": "添加附件",
  "Pending attachments": "待发送附件",
  Local: "本地",
  Worktree: "Worktree",
  "Read only": "只读",
  Checkout: "检出目录",
  "API endpoint": "API 端点",
  "Pi default": "Pi 默认",
  Model: "模型",
  "Permission mode": "权限模式",
  "Ask permissions": "每次询问",
  "Accept edits": "允许编辑",
  "Plan mode": "规划模式",
  "Auto · unavailable": "自动 · 暂不可用",
  "Stop Pi": "停止 Pi",
  "Send prompt": "发送提示词",
  "Send follow-up": "发送跟进",
  "Follow-up queued": "跟进已排队",
  "Follow-up was not queued": "跟进排队失败",
  pending: "待发",
  "Cancel all": "取消全部",
  "{count} follow-ups pending": "{count} 条跟进待处理",
  "Select a project folder before sending": "发送前请选择项目文件夹",
  "Wait for the repository check to finish": "请等待仓库检查完成",
  "A Git repository is required for an isolated worktree":
    "隔离 worktree 需要 Git 仓库",
  "Pi is still starting": "Pi 仍在启动",
  "Submitting prompt…": "正在提交提示词…",
  "Enter a prompt before sending": "请输入提示词后再发送",
  "Remove {name}": "移除 {name}",
  "Toggle user terminal (⌘J)": "显示或隐藏用户终端（⌘J）",
  Terminal: "终端",
  "Toggle project review pane": "显示或隐藏项目审查面板",
  Review: "审查",
  "Archive session metadata; Pi history is preserved":
    "归档任务元数据；Pi 历史仍会保留",
  "Archive?": "确认归档？",
  Archive: "归档",
  Rename: "重命名",
  Pin: "置顶",
  Unpin: "取消置顶",
  Trash: "垃圾桶",
  Restore: "恢复",
  "Delete permanently": "永久删除",
  "Are you sure you want to permanently delete this session?":
    "确定要永久删除此会话吗？",
  "No archived sessions": "没有已归档的会话",
  Archived: "已归档",
  Close: "关闭",
  Cancel: "取消",
  Pinned: "已置顶",
  "More actions": "更多操作",
  "Local environment": "本地环境",
  "not started": "未开始",
  connecting: "正在连接",
  saved: "已保存",
  running: "运行中",
  waiting: "等待确认",
  completed: "已完成",
  failed: "失败",
  idle: "空闲",
  starting: "正在启动",
  ready: "已就绪",
  stopped: "已停止",
  error: "错误",
  "Conversation": "对话",
  You: "你",
  "Working…": "正在工作…",
  "Jump to latest": "回到最新消息",
  "Session restored": "任务已恢复",
  "Project connected": "项目已连接",
  "Connecting to Pi": "正在连接 Pi",
  "Pi restored the history and context for this working branch.":
    "Pi 已恢复当前工作分支的历史和上下文。",
  "Pi is ready to inspect the project and follow your next instruction.":
    "Pi 已准备好读取项目并执行你的下一条指令。",
  "Restoring the local Pi session.": "正在恢复本地 Pi 任务。",
  Activity: "活动",
  "Tool approval": "工具授权",
  Waiting: "等待处理",
  Deny: "拒绝",
  "Allow once": "允许一次",
  Project: "项目",
  "Project inspector": "项目检查器",
  "detached HEAD": "游离 HEAD",
  "Local files": "本地文件",
  "Refresh project": "刷新项目",
  Changes: "更改",
  Files: "文件",
  "Filter project paths": "筛选项目路径",
  "Filter paths": "筛选路径",
  "All changes": "全部更改",
  "index + worktree": "暂存区 + 工作区",
  staged: "已暂存",
  "working tree": "工作区",
  "Working tree clean": "工作区无改动",
  "Pi file changes will appear here as they happen.":
    "Pi 的文件改动会实时出现在这里。",
  "The list is limited; use the filter above to narrow it down.":
    "列表已限量，请用上方输入框缩小范围。",
  "Unified diff · read only": "统一差异 · 只读",
  "Close preview": "关闭预览",
  "Review a change": "审查一项更改",
  "Preview a file": "预览文件",
  "Select a changed file or project file to preview it.":
    "选择一个改动文件或项目文件进行预览。",
  "No textual diff": "没有文本差异",
  "The file may be unchanged or contain binary content that cannot be shown inline.":
    "文件可能尚未变化，或只包含无法内联显示的二进制内容。",
  Diff: "差异",
  "Large diff truncated; the complete content remains in the Git working tree.":
    "大型差异已截断；完整内容仍保留在 Git 工作区中。",
  "Binary file": "二进制文件",
  "Only metadata is shown; binary content is not rendered as text.":
    "当前只显示元数据，不会把二进制内容伪装成文本。",
  "File preview": "文件预览",
  "Large file truncated; preview limit is 1 MiB / 5,000 lines.":
    "大文件已截断；预览上限为 1 MiB / 5,000 行。",
  "Binary content is not rendered as text.":
    "二进制内容不会以文本形式渲染。",
  "Start preview": "启动预览",
  "Stop preview": "停止预览",
  "Open in browser": "在浏览器中打开",
  "Preview console": "预览控制台",
  "Clear log": "清空日志",
  "No requests yet.": "暂无请求。",
  "Resize preview": "调整预览面板大小",
  "Toggle preview pane": "切换预览面板",
  "Start a local preview server to render HTML, images, and PDFs from this task.":
    "启动本地预览服务，即可在此渲染本任务的 HTML、图片与 PDF。",
  "Context compacted": "上下文已压缩",
  "Branch here": "在此分叉",
  "Compacting context…": "正在压缩上下文…",
  "Session tree": "会话树",
  "Current": "当前",
  "Loading session tree…": "正在加载会话树…",
  "No session tree yet.": "暂无会话树。",
  "Edit file": "编辑文件",
  Saved: "已保存",
  "Unsaved changes": "有未保存的更改",
  "No matching files": "未找到匹配的文件",
  "Try a different name or path fragment.":
    "换一个文件名或路径片段试试。",
  "Too many matches — narrow the search.":
    "匹配项过多——请缩小搜索范围。",
  "Timeline Density": "消息密度",
  "Timeline spacing and message padding.": "调整对话时间线的消息间距与内边距。",
  Comfortable: "适中",
  Compact: "紧凑",
  Spaced: "宽松",
  "User terminal": "用户终端",
  "User PTY · separate from Agent tools": "用户 PTY · 与智能体工具隔离",
  Restart: "重启",
  "Close terminal": "关闭终端",
  "Interactive zsh terminal": "交互式 zsh 终端",
  "terminal exited": "终端已退出",
  "with code": "退出码",
  "on signal": "信号",
  "Settings home": "设置主页",
  Endpoints: "端点",
  Extensions: "扩展",
  Updates: "更新",
  "Manage model gateways, local runtimes, and API credentials stored securely.":
    "管理模型网关、本地运行时和安全存储的 API 凭据。",
  "{count} configured": "已配置 {count} 个",
  "Edit profile": "编辑配置",
  "New profile": "新建配置",
  "Connect an API endpoint": "连接 API 端点",
  New: "新建",
  Name: "名称",
  Protocol: "协议",
  "Base URL": "基础 URL",
  "Default model": "默认模型",
  "Discovered automatically": "自动发现",
  "API Key": "API 密钥",
  "Saved in Keychain · leave blank to keep":
    "已存入钥匙串 · 留空可保留",
  "Not required": "无需填写",
  "Stored only in macOS Keychain": "仅存入 macOS 钥匙串",
  "Model catalog": "模型目录",
  "Discovering…": "正在发现…",
  "Discover now": "立即发现",
  "Enter the endpoint and API key to fetch models automatically.":
    "输入端点和 API 密钥后自动获取模型。",
  "{count} models · edit manually": "{count} 个模型 · 手动编辑",
  "Enter model ids manually": "手动输入模型 ID",
  Enabled: "已启用",
  "Default endpoint": "默认端点",
  "Remove saved key": "移除已保存密钥",
  "Saving…": "正在保存…",
  "Save Changes": "保存更改",
  "Add Endpoint": "添加端点",
  "No endpoints yet": "尚未配置端点",
  "Add an OpenAI-compatible, Anthropic-compatible, or local Ollama endpoint. Keys are never written to endpoints.json.":
    "添加 OpenAI Compatible、Anthropic Compatible 或本地 Ollama 端点。密钥不会写入 endpoints.json。",
  Default: "默认",
  "Discover required": "需要发现模型",
  Credential: "凭据",
  Keychain: "钥匙串",
  None: "无",
  "{count} models": "{count} 个模型",
  "Model catalog updated automatically": "模型目录已自动更新",
  Edit: "编辑",
  "Refreshing…": "正在刷新…",
  "Refresh models": "刷新模型",
  "Confirm Delete": "确认删除",
  Delete: "删除",
  "Endpoint error": "端点错误",
  "Waiting for endpoint input to settle…": "等待端点信息输入完成…",
  "Fetching the provider model catalog…": "正在获取服务商模型目录…",
  "Discovered {count} models": "发现 {count} 个模型",
  "No model ids were returned": "未返回模型 ID",
  "Review, isolate, and manage Pi Extensions. Every task loads only verified immutable snapshots in a restricted worker.":
    "审查、隔离并管理 Pi 扩展；每个任务只在受限 Worker 中加载已校验的不可变快照。",
  "Updating…": "正在更新…",
  "Update all ({count})": "全部更新（{count}）",
  "Checking…": "正在检查…",
  "Check updates": "检查更新",
  Installed: "已安装",
  Marketplace: "扩展市场",
  "{count} registered": "已登记 {count} 个",
  "Extension status": "扩展状态",
  "Official Pi Catalog": "Pi 官方目录",
  "Browse extensions": "浏览扩展",
  "Catalog content comes directly from pi.dev. Exact npm versions are installed with lifecycle scripts disabled, then scanned locally before you can enable them. Catalog inclusion is not a security endorsement.":
    "内容直接来自 pi.dev。安装时固定 npm 精确版本并关闭生命周期脚本，下载后还需通过本地隔离扫描；目录收录不等于安全背书。",
  "Search marketplace": "搜索扩展市场",
  "Search the official catalog…": "搜索官方目录…",
  "Sort marketplace": "扩展排序",
  "Most downloaded": "下载最多",
  "Recently published": "最近发布",
  "Name A–Z": "名称 A–Z",
  Refresh: "刷新",
  "Loading official catalog": "正在加载官方目录",
  "Fetching the extension catalog from pi.dev.":
    "正在从 pi.dev 获取扩展目录。",
  latest: "最新版本",
  "npm publisher": "npm 发布者",
  "Pi official catalog · npm exact version": "Pi 官方目录 · npm 精确版本",
  "Installing…": "正在安装…",
  "Add for review": "添加并审查",
  "No matching extensions": "没有匹配的扩展",
  "Try a shorter name or a different sort order.":
    "尝试更短的名称或切换排序方式。",
  Previous: "上一页",
  "Page {page} of {total}": "第 {page} / {total} 页",
  Next: "下一页",
  "Pi runtime & extensions": "Pi 运行时与扩展",
  "Core updates install in an isolated directory and pass a protocol preflight before activation. Extension updates always create a new immutable snapshot.":
    "核心更新先在独立目录安装并执行协议预检，成功后才切换；扩展更新始终创建新的不可变隔离快照。",
  "Pi-Agent Core": "Pi-Agent 核心",
  "Restart required": "需要重启",
  "Installing & preflighting…": "正在安装并预检…",
  "Install {version}": "安装 {version}",
  "Check now": "立即检查",
  "Status unavailable": "状态不可用",
  "Use Check now to query the official npm release.":
    "点击“立即检查”查询 npm 官方版本。",
  "Automatically update Pi-Agent": "自动更新 Pi-Agent",
  "Download, verify, and activate a new core before the desktop runtime starts.":
    "在桌面运行时启动前下载、校验并启用新核心。",
  "Automatically update installed extensions": "自动更新已安装扩展",
  "Keep info-only scans enabled automatically. Disable and request review when warnings or capabilities change.":
    "信息级扫描自动保持启用；出现警告或关键能力变化时停用并等待复核。",
  "Edit extension": "编辑扩展",
  "Register local extension": "登记本地扩展",
  "Inspect before enabling": "启用前先审查",
  "Local file or directory": "本地文件或目录",
  "File…": "文件…",
  "Folder…": "文件夹…",
  "Scanning…": "正在扫描…",
  Scan: "扫描",
  "{count} files": "{count} 个文件",
  "Enable for newly created Tasks": "为新建任务启用",
  "I reviewed and approve {count} elevated findings":
    "我已审查并批准 {count} 项高风险发现",
  "I reviewed and approve {count} elevated finding":
    "我已审查并批准 {count} 项高风险发现",
  "Save Extension": "保存扩展",
  "Register Extension": "登记扩展",
  "No extensions registered": "尚未登记扩展",
  "Register a local Pi Extension to review its capabilities before enabling it for new tasks.":
    "登记本地 Pi 扩展后，先审查其能力风险，再决定是否为新任务启用。",
  Disabled: "已停用",
  "{count} findings": "{count} 项发现",
  Reviewed: "已审查",
  Approved: "已批准",
  "Not approved": "未批准",
  "{count} snapshots": "{count} 个快照",
  "Update v{version}": "更新 v{version}",
  "Update check failed": "更新检查失败",
  "Managed Worker": "受控 Worker",
  "Security review": "安全审查",
  "{count} elevated": "{count} 项高风险",
  "No elevated findings": "无高风险发现",
  "Quarantine versions": "隔离版本",
  Isolated: "已隔离",
  "Review required": "需要审查",
  Active: "当前版本",
  Scanned: "已扫描",
  "Use version": "使用此版本",
  "Update to {version}": "更新到 {version}",
  "Review findings": "审查发现",
  "Edit source": "编辑来源",
  Disable: "停用",
  "Confirm enable": "确认启用",
  Enable: "启用",
  "Confirm Remove": "确认移除",
  Remove: "移除",
  "Extension error": "扩展错误",
  "Pi-Agent {version} was downloaded and passed protocol preflight. Restart Pi Desktop to activate it.":
    "Pi-Agent {version} 已下载并通过协议预检。重启 Pi Desktop 后启用。",
  "Pi-Agent {version} is already up to date.":
    "Pi-Agent {version} 已是最新版本。",
  "{name} is in quarantine. Review the security findings before enabling it.":
    "{name} 已下载到隔离区。请查看安全发现后再决定是否启用。",
  "Open Security review first. Click again to approve the current content hash and enable it.":
    "请先展开安全审查；再次点击即可批准当前内容哈希并启用。",
  "{name} was disabled.": "{name} 已停用。",
  "{name} is enabled in a restricted worker.":
    "{name} 已通过受限 Worker 启用。",
  "{package}@{version} was downloaded and scanned in quarantine. It is not enabled yet.":
    "{package}@{version} 已下载并完成隔离扫描，尚未启用。",
  "{name}@{version} was updated and passed an info-only security scan, so it remains enabled.":
    "{name}@{version} 已升级并通过信息级安全扫描，保持启用。",
  "{name}@{version} was updated to a new quarantined snapshot. Capability changes require review, so it is disabled.":
    "{name}@{version} 已升级到新的隔离快照。检测到能力变化，当前版本已停用并等待复核。",
  mo: "月",
  Bundled: "内置",
  Latest: "最新",
  "The scan reads at most 200 source or configuration files and 2 MiB in total. It never executes the extension or package.json scripts. Saving creates an isolated version snapshot; third-party source runs only in a restricted worker through the Capability Broker. Managed mode supports custom tools while hooks, commands, and renderers remain disabled.":
    "扫描最多读取 200 个源码或配置文件、总计 2 MiB；不会执行扩展或 package.json 脚本。保存后会创建隔离版本快照；第三方源码只在受限 Worker 中通过 Capability Broker 运行。受控模式支持自定义工具，事件 Hook、命令和自定义 Renderer 保持禁用。",
  "This legacy profile points directly to a path. Review and save it again to create an isolated snapshot.":
    "这是旧版直接路径配置。请重新审查并保存，以生成隔离快照。",
  info: "信息",
  warning: "警告",
  critical: "严重",
  "Interrupted approval": "授权已中断",
  "A previous approval expired when its worker stopped.":
    "Worker 停止后，之前的授权请求已失效。",
  "Approval required": "需要授权",
  "Recent activity restored": "近期活动已恢复",
  "Older Event Store records remain on disk and are loaded on demand.":
    "更早的事件记录仍保留在磁盘中，并会按需加载。",
  "Could not restore task events": "无法恢复任务事件",
  "Pi Host exited; restart to reconnect this session.":
    "Pi Host 已退出；请重启以重新连接此任务。",
  "Pi Host exited with code {code}.": "Pi Host 已退出，代码 {code}。",
  "Pi stopped before responding": "Pi 在回复前已停止",
  Live: "实时",
  Event: "事件",
  "Running…": "进行中…",
  Completed: "已完成",
  Failed: "失败",
  Input: "输入",
  Output: "输出",
  Tool: "工具",
  unknown: "未知",
  "Tool failed": "工具执行失败",
  "Tool completed": "工具执行完成",
  "Agent turn started": "智能体回合已开始",
  "Agent turn settled": "智能体回合已结束",
  "Allowed once": "已允许一次",
  Denied: "已拒绝",
  "Analyze these attachments and explain the key findings, risks, and recommended next steps.":
    "请分析这些附件，并说明关键发现、风险和建议的下一步。",
  "Attachments:": "附件：",
  "list separator": "、",
  "Prompt submitted": "提示词已提交",
  Copy: "复制",
  Progress: "进度",
  "Task activity will appear here.": "任务进展会显示在这里。",
  "Prompt was not delivered": "提示词未能发送",
  "Extension disabled": "扩展已为此任务停用",
  "Some extensions were disabled for this task":
    "部分扩展启动失败，已仅为此任务停用",
  "Pi did not acknowledge {command}.": "Pi 未确认命令 {command}。",
  "Automatic update completed with warnings": "自动更新完成，但存在警告",
  Keep: "保留",
  Revert: "撤销",
  "Revert file": "撤销文件",
  "Keep file": "保留文件",
  "Delete file": "删除文件",
  "Apply change": "应用更改",
  "Applying…": "应用更改中…",
  "Untracked file": "未跟踪文件",
  "Delete to remove, or keep as part of this task.":
    "删除以移除，或保留作为本任务的一部分。",
  "Review each hunk, then revert what should not change.":
    "逐块审查，撤销不应发生的更改。",
  "Select a changed file to review and revert individual hunks.":
    "选择发生更改的文件，以审查并撤销单个变更块。",
};

const enUS: Record<string, string> = {
  "list separator": ", ",
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(readInitialLocale);
  const [theme, setThemeState] = useState<AppTheme>(readInitialTheme);

  useEffect(() => {
    window.localStorage.setItem(localeStorageKey, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, theme);
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
  }, []);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setThemeState(nextTheme);
  }, []);

  const t = useCallback(
    (key: string, variables?: Record<string, string | number>) => {
      const messages = locale === "zh-CN" ? zhCN : enUS;
      const template = messages[key] ?? key;
      if (!variables) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(variables, name)
          ? String(variables[name])
          : match,
      );
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, theme, setLocale, setTheme, t }),
    [locale, setLocale, setTheme, t, theme],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

function readInitialLocale(): AppLocale {
  const stored = window.localStorage.getItem(localeStorageKey);
  if (stored === "zh-CN" || stored === "en-US") {
    return stored;
  }
  return navigator.languages.some((language) =>
    language.toLocaleLowerCase().startsWith("zh"),
  )
    ? "zh-CN"
    : "en-US";
}

function readInitialTheme(): AppTheme {
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}
