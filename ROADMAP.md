# Pi‑Code Roadmap（终稿）

**版本:** v0.2.0  
**最后更新:** 2026-07-28  
**架构:** VS Code Extension + `pi --mode rpc` 子进程 (JSONL RPC)

---

## 架构约束说明

Pi Code 的架构将 Provider 协议适配、Agent 智能体循环、工具执行、MCP 管理、会话持久化和所有模型通信委托给 `pi` CLI 子进程，扩展层作为 UI 桥接器通过 JSONL RPC 与 pi CLI 通信。

因此交付标准（`交付标准.md`）中的以下功能需要 pi CLI 增加 RPC 协议暴露，扩展层无法独立实现：

- 计划模式 (F-301~F-307)
- Provider 适配器 (Section 4)
- MCP 管理 (Section 5.1)
- 子智能体 (Section 5.4)
- 检查点/回滚 (F-705~F-711)
- Git 写操作 (Section 3.10)
- 流式状态机验证 (T-001~T-012)
- 流式故障转移 (Section 4.4)
- E2E 场景 (Section 9.2, 需要 Extension Development Host)

---

## 扩展层已完成 (29项)

### 代码功能

| 类别 | 完成项 |
|------|--------|
| RPC 协议 | 12 命令, 19 事件, 子进程管理, 自动重启, 请求队列 |
| 会话管理 | 多会话, 标签持久化, 分叉, 恢复, 每会话 workspaceRoot (F-111) |
| 差异审查 | F-403 Hunk级解析/接受/拒绝, F-406 冲突检测, F-409 格式化, **F-410/411/412** 自动打开/定位/高亮, F-414 变更汇总 |
| Webview UI | 流式聊天, 思考块, F-105 @工作区文件, F-106 @行号, F-107 @目录, F-108 拖放, 斜杠命令, Toolbar Git状态 (F-110) |
| 安全 | S-003 Workspace Trust, S-004 路径保护, S-005 敏感文件过滤, S-007 CSP, S-010 日志脱敏 |
| 配置 | F-003 onCommand 延迟激活, F-113/114 上下文可见, F-404 permissionMode, F-413 防跳动, F-508 大输出截断 |

### 测试

| 模块 | 测试数 | 状态 |
|------|--------|------|
| lineReader | 12 | ✅ |
| reduceMessages + convertAgentMessages | 19 | ✅ |
| PiRpcClient + PiEventBus | 16 | ✅ |
| RequestQueue | 6 | ✅ |
| 安全验证 | 其余 | ✅ |
| **合计** | **75** | ✅ **全部通过** |

### 文档 (22项)

PRD, TECH_DESIGN, ROADMAP, TEST_PLAN, SECURITY, CHANGELOG, README, docs/delivery-checklist.md, CI/CD, 9个 docs/* 文档 — 全部齐备.

### 构建产物

| 指标 | 结果 |
|------|------|
| TypeScript 编译 | ✅ 零错误 |
| Webpack 构建 | ✅ ext 45K + ui 188K |
| VSIX 包 | ✅ 157 KB, 33 文件 |

---

## 未达到交付标准的原因

扩展层已完成其架构能力范围内的全部可完成项目。剩余的 ~20 项交付标准要求的功能需要在 pi CLI 端添加 RPC 命令后由 pi 团队实施，不属于本次扩展层开发范围。

详见 [docs/delivery-checklist.md](docs/delivery-checklist.md) 完整逐项对照表。
