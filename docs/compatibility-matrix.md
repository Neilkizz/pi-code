# Pi Code — System Compatibility Test Matrix / 系统兼容性测试矩阵

**Version:** 1.0  
**Status:** Final  
**Last updated:** 2026-07-27  

---

## 1. Operating System Compatibility / 操作系统兼容性

The following matrix defines the required OS and platform support per the delivery standards (Section 8).

以下矩阵定义了交付标准（第八节）所要求的操作系统和平台支持。

| Environment / 环境 | Requirement / 要求 | Status / 状态 | Notes / 备注 |
| --- | --- | --- | --- |
| **macOS Apple Silicon** | Full pass, primary platform / 完整通过，首要平台 | In progress | Primary development and QA target. Must pass all E2E scenarios. / 主要开发和 QA 目标。必须通过所有端到端场景。 |
| **macOS Intel x64** | Full pass (implied) / 完整通过（隐含） | In progress | Secondary macOS target. Rosetta 2 binary compatibility required. / 次要 macOS 目标。需要 Rosetta 2 二进制兼容性。 |
| **Windows 11 x64** | Full pass / 完整通过 | Planned | PowerShell integration, path normalization with backslashes, CRLF handling. / PowerShell 集成、反斜杠路径规范化、CRLF 处理。 |
| **Windows 10 x64** | Core features (expected) / 核心功能（预期） | Planned | Lower priority than Windows 11. / 优先级低于 Windows 11。 |
| **Ubuntu 24.04 x64** | Full pass / 完整通过 | Planned | Reference Linux platform. / 参考 Linux 平台。 |
| **Ubuntu 22.04 x64** | Core features (expected) / 核心功能（预期） | Planned | Extended Linux support. / 扩展 Linux 支持。 |
| **Debian 12 x64** | Core features (expected) / 核心功能（预期） | Planned | Community-supported platform. / 社区支持平台。 |
| **Fedora 40 x64** | Core features (expected) / 核心功能（预期） | Planned | Community-supported platform. / 社区支持平台。 |

### 1.1 OS-Specific Test Items / 操作系统专项测试项

| Test Item / 测试项 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Extension activation / 扩展激活 | ✅ | ✅ | ✅ |
| `pi` CLI path detection (PATH) / `pi` CLI 路径检测（PATH） | ✅ | ✅ | ✅ |
| `pi` CLI path detection (absolute) / `pi` CLI 路径检测（绝对路径） | ✅ | ✅ | ✅ |
| Shell integration (zsh) / Shell 集成（zsh） | ✅ | — | — |
| Shell integration (PowerShell) / Shell 集成（PowerShell） | — | ✅ | — |
| Shell integration (bash) / Shell 集成（bash） | ✅ | — | ✅ |
| File path normalization / 文件路径规范化 | ✅ | ✅ | ✅ |
| Session file persistence / 会话文件持久化 | ✅ | ✅ | ✅ |
| JSONL CRLF handling / JSONL CRLF 处理 | ✅ | ✅ | ✅ |
| Keyboard shortcuts / 键盘快捷键 | ✅ | ✅ | ✅ |
| Status bar display / 状态栏显示 | ✅ | ✅ | ✅ |
| Webview rendering / Webview 渲染 | ✅ | ✅ | ✅ |
| Terminal creation / 终端创建 | ✅ | ✅ | ✅ |
| Process lifecycle / 进程生命周期 | ✅ | ✅ | ✅ |

---

## 2. VS Code Version Compatibility / VS Code 版本兼容性

| Version / 版本 | Requirement / 要求 | Status / 状态 |
| --- | --- | --- |
| **VS Code Stable** (latest) / VS Code Stable（最新版） | Full pass / 完整通过 | In progress |
| **VS Code Stable** (previous) / VS Code Stable（前一版） | Full pass / 完整通过 | Planned |
| **VS Code Stable** (two versions back) / VS Code Stable（再前一版） | Full pass / 完整通过 | Planned |
| **VS Code Insiders** | Core features, no blocking errors / 核心功能无阻断性错误 | Planned |
| **VS Code Codium** | Community support / 社区支持 | Not planned |

### 2.1 VS Code API Requirements / VS Code API 要求

| API / Feature | Description / 描述 | Used In / 使用位置 |
| --- | --- | --- |
| `vscode.ExtensionContext.globalState` | Key-value storage for session tab list and settings | `SessionManager`, `Configuration` |
| `vscode.ExtensionContext.workspaceState` | Workspace-scoped key-value storage | `Configuration` |
| `vscode.ExtensionContext.secrets` | Encrypted storage for sensitive data (reserved) | — |
| `vscode.WebviewViewProvider` | Webview-based chat panel in sidebar | `ChatProvider` |
| `vscode.WebviewView` | Webview lifecycle management | `ChatProvider` |
| `vscode.Webview.postMessage` | Bidirectional webview-to-host communication | `WebviewMessenger`, UI |
| `vscode.Webview.onDidReceiveMessage` | Receive messages from webview | `WebviewMessenger` |
| `vscode.commands.registerCommand` | Command registration and keybinding | `Commands` |
| `vscode.window.createOutputChannel` | Log output channel | Diagnostic logs |
| `vscode.window.createTerminal` | Integrated terminal for command execution | `PiTerminal` |
| `vscode.window.registerTreeDataProvider` | Sidebar session list tree | `SessionTreeProvider` |
| `vscode.window.registerWebviewViewProvider` | Chat panel registration | `ChatProvider` |
| `vscode.window.activeTextEditor` | Current file and selection detection | Chat context |
| `vscode.window.tabGroups` | Editor tab management | `DiffController` |
| `vscode.window.showInformationMessage` | User notifications | Auth, errors |
| `vscode.window.showWarningMessage` | Permission confirmations | Permission system |
| `vscode.window.showQuickPick` | Quick selection UI | Session picker |
| `vscode.Uri` | URI handling and path normalization | File operations |
| `vscode.workspace.workspaceFolders` | Multi-root workspace support | File scope |
| `vscode.workspace.fs` | Virtual file system API | File operations |
| `vscode.workspace.isTrusted` | Workspace Trust detection | Permission mode |
| `vscode.workspace.onDidChangeConfiguration` | Settings change listener | `Configuration` |
| `vscode.workspace.textDocuments` | Open document access | Context building |
| `vscode.workspace.findFiles` | File search in workspace | Code exploration |
| `vscode.commands.executeCommand` | Invoke VS Code commands | `vscode.diff` navigation |
| `vscode.languages.getDiagnostics` | Read Problems panel diagnostics | Context building |
| `vscode.scm` | Source control API | Git integration |
| `vscode.env` | Environment detection | Platform detection |

### 2.2 engines.vscode

```json
{
  "engines": {
    "vscode": "^1.85.0"
  }
}
```

- **Minimum:** VS Code 1.85.0 (January 2024 release)
- **Format:** Caret range — compatible with 1.85.x and all later 1.x versions
- **最低版本：** VS Code 1.85.0（2024 年 1 月发布）
- **格式：** Caret 范围——兼容 1.85.x 及所有更新的 1.x 版本

### 2.3 API Features Status / API 功能状态

| Feature / 功能 | API Required / 所需 API | Status / 状态 | Version Added / 添加版本 |
| --- | --- | --- | --- |
| Chat panel / 聊天面板 | `WebviewViewProvider` | ✅ Implemented | 1.74.0 |
| Multi-session tabs / 多会话标签页 | `globalState` | ✅ Implemented | 1.0.0 |
| Model switching / 模型切换 | IPC via webview | ✅ Implemented | — |
| Thinking level / 思考级别 | IPC via webview | ✅ Implemented | — |
| @-mentions / @-引用 | `workspace.findFiles` | ✅ Implemented | 1.0.0 |
| Slash commands / 斜杠命令 | IPC via webview | ✅ Implemented | — |
| Diff review / Diff 审查 | `commands.executeCommand("vscode.diff")` | ✅ Implemented | 1.0.0 |
| Terminal integration / 终端集成 | `window.createTerminal` | ✅ Implemented | 1.0.0 |
| Session tree / 会话树 | `registerTreeDataProvider` | ✅ Implemented | 1.0.0 |
| Plan mode / 计划模式 | Webview, IPC | ⚠️ Planned | — |
| Permission system / 权限体系 | Workspace Trust, IPC | ⚠️ Planned | — |
| Checkpoints / 检查点 | globalState, workspaceState | ⚠️ Planned | — |
| Git workflow / Git 工作流 | `scm` API | ⚠️ Planned | — |

---

## 3. Workspace Configuration Compatibility / 工作区配置兼容性

| Configuration / 配置 | Requirement / 要求 | Status / 状态 |
| --- | --- | --- |
| **Single file mode** / 单文件模式 | Chat and file reference allowed. No dangerous workspace operations. / 允许聊天和文件引用。禁止工作区级危险操作。 | ✅ Supported |
| **Single root workspace** / 单根工作区 | Full support / 完整支持 | ✅ Supported |
| **Multi-root Workspace** / 多根工作区 | Full support with per-root context isolation. / 完整支持，每个根目录上下文隔离。 | ✅ Supported |
| **No workspace / untitled** / 无工作区 | Read-only mode, limited file operations. / 只读模式，有限的文件操作。 | ⚠️ Partial |

### 3.1 Multi-root Workspace Test Items / 多根工作区测试项

| Test Item / 测试项 | Requirement / 要求 |
| --- | --- |
| File search spans all roots / 文件搜索覆盖所有根目录 | ✅ |
| Path references include root context / 路径引用包含根目录上下文 | ✅ |
| @-mentions disambiguate same-name files / @-引用消除同名文件歧义 | ✅ |
| Commands execute in correct root / 命令在正确的根目录下执行 | ✅ |
| `.gitignore` per-root respect / 每个根目录分别遵守 `.gitignore` | ✅ |
| Session isolation per root / 每个根目录的会话隔离 | ✅ |

### 3.2 Single File Mode Test Items / 单文件模式测试项

| Test Item / 测试项 | Requirement / 要求 |
| --- | --- |
| Chat available / 聊天可用 | ✅ |
| File reference (current file) / 文件引用（当前文件） | ✅ |
| Selection reference / 选区引用 | ✅ |
| File search disabled / 文件搜索已禁用 | ✅ |
| Command execution disabled / 命令执行已禁用 | ✅ |
| File write disabled / 文件写入已禁用 | ✅ |
| `.gitignore` not applicable / `.gitignore` 不适用 | ✅ |

---

## 4. Remote Development Compatibility / 远程开发兼容性

| Environment / 环境 | Requirement / 要求 | Status / 状态 | Notes / 备注 |
| --- | --- | --- | --- |
| **Remote SSH** | Files/commands execute on the remote correctly. / 文件和命令在远端正确执行。 | Planned | Extension runs on remote host. `pi` CLI must be installed on remote. / 扩展在远端运行。`pi` CLI 必须在远端安装。 |
| **Dev Containers** | Files, terminal, and provider configuration locations correct. / 文件、终端和提供商配置位置正确。 | Planned | Extension runs inside container. `pi` CLI must be installed in container image. / 扩展在容器内运行。`pi` CLI 必须安装在容器镜像中。 |
| **WSL** | Windows UI vs WSL workspace path not confused. / Windows UI 与 WSL 工作区路径不混淆。 | Planned | Extension runs in WSL. VS Code UI runs on Windows. Path mapping must be correct. / 扩展在 WSL 中运行。VS Code UI 在 Windows 上运行。路径映射必须正确。 |
| **GitHub Codespaces** | Core features functional. / 核心功能可用。 | Planned | Cloud-hosted environment. / 云端托管环境。 |

### 4.1 Remote Extension Host Considerations / 远程扩展宿主注意事项

VS Code Remote Development 的核心区别：扩展宿主位置决定工具的执行位置。Pi Code 作为 Workspace Extension，在远程环境中在远端运行。

**Key differences / 关键差异：**

| Aspect / 方面 | Local / 本地 | Remote / 远程 |
| --- | --- | --- |
| Extension host location / 扩展宿主位置 | Same machine / 同一台机器 | Remote machine / 远端机器 |
| `pi` CLI location / `pi` CLI 位置 | Local machine / 本机 | Remote machine / 远端机器 |
| Terminal execution / 终端执行 | Local terminal / 本地终端 | Remote terminal / 远端终端 |
| `localhost` meaning / `localhost` 含义 | Local machine / 本机 | Remote machine / 远端机器 |
| File system access / 文件系统访问 | Local files / 本地文件 | Remote filesystem / 远端文件系统 |
| Credentials location / 凭据位置 | `~/.pi/credentials/` on local | `~/.pi/credentials/` on remote |

### 4.2 Remote Test Items / 远程测试项

| Test Item / 测试项 | SSH | Dev Containers | WSL |
| --- | --- | --- | --- |
| Extension activation / 扩展激活 | ✅ | ✅ | ✅ |
| `pi` CLI path detection / `pi` CLI 路径检测 | ✅ | ✅ | ✅ |
| File read/write on remote / 远端文件读写 | ✅ | ✅ | ✅ |
| Command execution on remote / 远端命令执行 | ✅ | ✅ | ✅ |
| Terminal creation on remote / 远端终端创建 | ✅ | ✅ | ✅ |
| Workspace path correct / 工作区路径正确 | ✅ | ✅ | ✅ |
| `localhost` address correct / `localhost` 地址正确 | ✅ | ✅ | ✅ |
| Multi-root support / 多根支持 | ✅ | ✅ | ⚠️ |
| Session persistence / 会话持久化 | ✅ | ✅ | ✅ |
| Provider config location / 提供商配置位置 | ✅ | ✅ | ✅ |

---

## 5. Shell Compatibility / Shell 兼容性

| Shell | Platform / 平台 | Status / 状态 |
| --- | --- | --- |
| zsh | macOS, Linux | ✅ Supported |
| bash | Linux, macOS, WSL | ✅ Supported |
| PowerShell 7+ | Windows, Linux, macOS | ⚠️ Planned |
| PowerShell Desktop (5.1) | Windows | ⚠️ Planned |
| fish | Linux, macOS | ⚠️ Community |
| fish | macOS | ⚠️ Community |

---

## 6. Node.js Version Compatibility / Node.js 版本兼容性

| Version / 版本 | Requirement / 要求 | Status / 状态 |
| --- | --- | --- |
| Node.js 18.x | Minimum requirement / 最低要求 | ✅ Supported |
| Node.js 20.x | Fully supported / 完整支持 | ✅ Supported |
| Node.js 22.x | Fully supported / 完整支持 | ✅ Supported |
| Node.js 23.x | Expected compatible / 预期兼容 | ⚠️ Untested |

---

## 7. Version Matrix Summary / 版本矩阵总结

Test grid for release qualification / 版本发布资格测试网格：

```
                          macOS AS  Win11  Ubuntu 24.04  Remote SSH  Dev Containers  WSL
VS Code Stable (latest)     ✅      ✅       ✅          ✅          ✅             ✅
VS Code Stable (-1)         ✅      ✅       ✅          ✅          ✅             ✅
VS Code Stable (-2)         ✅      ✅       ✅          ✅          ✅             ✅
VS Code Insiders            ⚠️      ⚠️       ⚠️          ⚠️          ⚠️             ⚠️
```

Legend / 图例：

- ✅ = Full pass required / 必须完整通过
- ⚠️ = Core features only, no blocking errors / 仅核心功能，无阻断性错误
- — = Not tested / 不测试

---

## 8. Test Environment Specification / 测试环境规格

| Environment / 环境 | Arch / 架构 | RAM | Storage / 存储 | VS Code |
| --- | --- | --- | --- | --- |
| macOS | Apple Silicon (M1/M2/M3/M4) | ≥ 16 GB | ≥ 50 GB free | ^1.85.0 |
| Windows 11 | x86_64 | ≥ 16 GB | ≥ 50 GB free | ^1.85.0 |
| Ubuntu 24.04 | x86_64 | ≥ 8 GB | ≥ 50 GB free | ^1.85.0 |
