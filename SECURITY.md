# Pi Code — 安全文档 (SECURITY)

**版本:** 1.0  
**状态:** 正式发布  
**最后更新:** 2026-07-27  

---

## 1. 安全架构总览

Pi Code 采用"纵深防御"安全策略，从以下层面保护用户数据和系统安全：

```
┌────────────────────────────────────────────────────┐
│                  安全控制层级                        │
├────────────────────────────────────────────────────┤
│ 1. VS Code 安全机制                                 │
│    - Workspace Trust                                │
│    - Extension Host 隔离                            │
│    - SecretStorage 加密存储                         │
├────────────────────────────────────────────────────┤
│ 2. Webview 隔离                                     │
│    - Content Security Policy                        │
│    - postMessage kind 白名单                        │
│    - 无 Node/FS 直接访问                            │
├────────────────────────────────────────────────────┤
│ 3. 路径安全                                         │
│    - 路径规范化                                     │
│    - 工作区边界检查                                 │
│    - .gitignore 遵守                                │
├────────────────────────────────────────────────────┤
│ 4. 密钥安全                                         │
│    - 不存储 API Key（委托 pi CLI）                  │
│    - 配置脱敏输出                                   │
├────────────────────────────────────────────────────┤
│ 5. 命令执行安全                                     │
│    - 权限分层控制                                   │
│    - 敏感命令单独确认                               │
│    - 命令参数转义                                   │
└────────────────────────────────────────────────────┘
```

---

## 2. 密钥管理

### 2.1 API Key 存储

Pi Code **不存储** API Key 或 Provider 凭据。所有凭据管理委托给 `pi` CLI：

```
pi CLI 凭据存储路径: ~/.pi/credentials/
                    ├── /anthropic
                    ├── /openai
                    ├── /google
                    └── ...
```

### 2.2 安全要求（S-001, S-002）

| 要求 | 状态 | 说明 |
| --- | --- | --- |
| S-001: 密钥存储 | ✅ | API Key 仅保存在 VS Code SecretStorage 或系统密钥链（pi CLI 管理） |
| S-002: 配置脱敏 | ✅ | settings.json、日志和会话文件中无明文密钥 |

### 2.3 配置脱敏规则

配置输出时自动处理以下字段：

- `api_key` → `***`
- `apiKey` → `***`
- `token` → `***`
- `password` → `***`
- `secret` → `***`

---

## 3. Webview 安全

### 3.1 Content Security Policy（S-007）

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               style-src ${csp} 'unsafe-inline';
               script-src ${csp};
               img-src ${csp} data:;" />
```

- `default-src 'none'` — 默认禁止所有资源加载
- `style-src ${csp} 'unsafe-inline'` — 仅允许扩展的样式表和内联样式
- `script-src ${csp}` — 仅允许扩展打包的 JS bundle
- `img-src ${csp} data:` — 仅允许扩展资源和 data: URI

### 3.2 postMessage 白名单（S-008）

所有从 Webview 接收的消息经过 `decodeFromWebview()` 严格校验：

```typescript
const validKinds = new Set([
  "prompt", "steer", "abort",
  "setModel", "cycleModel", "setThinkingLevel",
  "login", "logout",
  "acceptDiff", "rejectDiff",
]);
if (!validKinds.has(d.kind)) return null;  // 拒绝未知类型
```

### 3.3 Webview 隔离（S-014）

- Webview 在 VS Code 沙箱 iframe 中运行
- 无法直接访问 Node.js API
- 无法读写文件系统
- 无法访问 ExtensionContext.secrets

---

## 4. 路径安全

### 4.1 路径规范化（F-208）

所有路径操作前执行规范化：

```typescript
// 解析 .. 和符号链接
const normalized = path.resolve(workspaceRoot, userProvidedPath);
// 检查是否在工作区范围内
if (!normalized.startsWith(workspaceRoot)) {
  throw new Error("Path outside workspace");
}
```

### 4.2 工作区边界（S-004）

| 要求 | 状态 | 说明 |
| --- | --- | --- |
| S-004: 路径边界 | ✅ | 默认只允许工作区根目录以内 |
| F-208: 路径安全 | ✅ | 路径规范化后才访问 |

### 4.3 敏感文件保护（S-005）

默认排除以下模式的路径（遵守 `.gitignore`）：

```
.env*
*.key
*.pem
id_rsa*
credentials
config.json          (含密钥的配置文件)
node_modules/
dist/
build/
.next/
coverage/
```

---

## 5. 命令执行安全

### 5.1 命令注入防护（S-006）

所有命令参数经过正确转义，不通过字符串拼接隐式执行：

```typescript
// 安全：使用 spawn 而非 exec
const child = spawn(executable, args, {
  cwd: this.opts.cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

// 不安全（不使用）：
// const child = exec(`${executable} ${userInput}`);
```

### 5.2 权限分层（F-502, F-503）

| 模式 | 文件修改 | 命令执行 | 网络请求 |
| --- | --- | --- | --- |
| 只读 | ❌ 禁止 | ❌ 禁止 | ❌ 禁止 |
| 计划 | ❌ 禁止 | ⚠️ 仅读取 | ❌ 禁止 |
| 手动 | ⚠️ 每次确认 | ⚠️ 每次确认 | ⚠️ 每次确认 |
| 自动编辑 | ✅ 普通文件 | ⚠️ 危险命令确认 | ⚠️ 首次域名确认 |

### 5.3 敏感命令列表（F-512）

以下命令类别每次执行前必须单独确认：

```
- rm / del / rmdir / rm -rf
- sudo / doas / runas
- chmod / chown / chattr
- git reset --hard / git push --force / git clean -fd
- curl / wget (新域名首次)
- ssh / scp / rsync
- systemctl / service
- shutdown / reboot / poweroff
- mkfs / fdisk / dd / format
```

---

## 6. 敏感信息脱敏

### 6.1 日志脱敏（S-010）

所有日志输出中自动脱敏以下内容：

| 模式 | 替换为 |
| --- | --- |
| API Key | `***` |
| Authorization header | `Bearer ***` |
| Token/Cookie | `***` |
| 环境变量值（含 KEY/TOKEN/SECRET） | `[REDACTED]` |
| 私钥内容 | `[REDACTED PRIVATE KEY]` |

### 6.2 遥测隐私（S-011）

| 要求 | 状态 | 说明 |
|---|---|---|
| S-011: 遥测 | ✅ | 默认不上传源代码、Prompt、Diff、命令输出和文件路径 |

当前版本无内置遥测功能。仅包含本地观察性指标（重启计数、RTT 延迟、命令计数）。

---

## 7. 审计日志

### 7.1 审计事件（S-015）

以下操作记录审计日志：

| 类别 | 记录内容 |
| --- | --- |
| 文件操作 | 路径、操作类型（read/write/delete）、时间 |
| 命令执行 | 完整命令、工作目录、退出码、授权来源、时间 |
| 权限决策 | 操作、请求模式、授予/拒绝、时间 |
| 网络请求 | URL、域名、首次/后续 |
| MCP 调用 | 服务器、工具名、参数（脱敏后）、时间 |
| Provider 变更 | 从/到、时间 |

### 7.2 日志格式

```
[2026-07-27T10:30:00.000Z] [info] [session abc-123] command executed: pwd (exit=0, cwd=/workspace)
[2026-07-27T10:30:05.000Z] [warn] [permission] file write to /workspace/src/app.ts authorized (mode=manual)
[2026-07-27T10:30:10.000Z] [error] [security] path escape blocked: /etc/passwd (outside workspace)
```

---

## 8. Workspace Trust

### 8.1 受信模式（S-003）

VS Code Workspace Trust 集成：

| Trust Mode | Pi Code 行为 |
| --- | --- |
| Trusted | 完整功能 — 聊天、文件修改、命令执行 |
| Restricted | 只读模式 — 仅允许聊天、文件读取、代码搜索 |

### 8.2 实现策略

```typescript
if (!vscode.workspace.isTrusted) {
  // 降级为只读模式
  // 禁止文件写入
  // 禁止命令执行
  // 禁止 MCP 工具调用
  vscode.window.showWarningMessage(
    "Pi Code: Workspace is not trusted. Running in read-only mode."
  );
}
```

---

## 9. 依赖安全

### 9.1 依赖审计（S-012）

| 要求 | 状态 | 说明 |
|---|---|---|
| S-012: 依赖安全 | ✅ | 正式发布时不存在 Critical 或 High 级已知依赖漏洞 |

依赖审计流程：

```bash
npm audit          # 检查已知漏洞
npm outdated       # 检查过期依赖
```

### 9.2 最小依赖原则

- 运行时依赖最小化
- 不使用 eval()、new Function() 等动态执行
- 所有依赖版本锁定在 package-lock.json

---

## 10. 安全测试

通过以下测试验证安全措施有效性：

| 测试 | 方法 |
| --- | --- |
| XSS 注入 | 在消息/文件路径/文件名中注入 HTML/JS，验证不执行 |
| Path Traversal | 使用 `../../../etc/passwd` 路径测试越权读取 |
| Command Injection | 在文件名/路径中注入 `; rm -rf /` 等命令 |
| postMessage 注入 | 发送未知 kind 消息，验证被拒绝 |
| CSP 绕过 | 尝试加载外部脚本和资源 |
| Secret 泄漏 | 验证 API Key 不出现在日志和异常栈中 |
| Workspace Trust | 在不可信工作区中验证功能降级 |
