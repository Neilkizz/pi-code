# A3: RPC 集成测试框架 — 实施总结

**版本:** 1.0  
**状态:** ✅ 已完成 (2026-07-29)  
**相关文件:** TEST_PLAN.md (4.2 节), docs/known-issues.md (KI-002)

---

## 1. 目标

建立可重复、结构化的集成测试框架，覆盖 PiRpcClient 与 RPC 子进程的全部交互路径——包括进程生命周期、JSONL 协议、事件流、错误处理和超时场景。

这些场景无法被纯单元测试覆盖，因为 PiRpcClient 管理真实子进程。

---

## 2. 架构

```
┌────────────────────────────────────┐
│          Mocha Test Runner         │
│  (test/integration/*.test.ts)      │
└──────────┬──────────────┬──────────┘
           │ spawn        │
           ▼              │
┌──────────────────┐      │ JSONL
│  mockRpcServer    │◄─────┤ (stdin)
│  (Node.js 进程)   ├──────► (stdout)
└──────────────────┘      │
                          │
  PiRpcClient ────────────┘
  (测试对象)
```

Mock server 通过 `process.execPath` + `-r ts-node/register` 启动，通过环境变量 `MOCK_SCENARIO` 选择行为。

### PiRpcClient 扩展

为支持 mock server，在 `PiRpcClientOptions` 中新增：

| 选项 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `skipModePrefix` | `boolean` | `false` | 跳过 `--mode rpc` 前缀（mock server 不需要） |
| `env` | `Record<string, string>` | 未设置 | 传递给子进程的额外环境变量（如 `MOCK_SCENARIO`） |

---

## 3. Mock RPC Server

**文件:** `test/integration/mockRpcServer.ts`

通过 `MOCK_SCENARIO` 环境变量切换场景：

| 场景 | 行为 | 测试用途 |
|------|------|----------|
| `echo` | 对每个命令立即返回 `success: true` 响应 | 基础命令测试 |
| `events` | 对 `prompt`/`steer`/`follow_up` 先发事件流再响应 | 事件总线测试 |
| `garbage` | 正常响应前写随机非 JSON 行 | 容错测试 |
| `slow` | 延迟 5 秒再响应 | 超时测试 |
| `crash` | 第一条命令后响应然后 exit(1) | 崩溃/重连测试 |
| `endless` | 永不响应 | 挂起/超时测试 |

---

## 4. 测试覆盖

4 个测试文件，29 个测试用例：

### 生命周期测试 (`rpc-lifecycle.test.ts` — 8 个)

| 用例 | 验证内容 |
|------|----------|
| 启动子进程并生效 | `isAlive === true` |
| dispose 清理 | SIGTERM → 清理，幂等性 |
| start() 幂等 | 重复调用不创建新进程 |
| 析构后 start() | 不恢复 |
| prompt 正常收发 | `commandCount >= 1` |
| 崩溃后拒绝请求 (autoReconnect=false) | 错误消息含 "exited" 或 "not running" |
| 崩溃后自动重连 (autoReconnect=true) | 恢复 alive，命令可正常发送 |
| dispose 取消重连 | 重启定时器被清理 |

### 命令测试 (`rpc-commands.test.ts` — 13 个)

全部 11 个 RPC 命令类型 + 事件流验证：
prompt, get_state, get_available_models, cycle_model, abort, new_session, set_thinking_level, set_model, get_messages, set_session_name, steer, follow_up, events scenario

### 协议测试 (`rpc-protocol.test.ts` — 5 个)

- 垃圾行不影响正常命令
- 多个顺序命令
- 并发命令 (FIFO)
- commandCount 和 roundTripMs 追踪
- round-trip 时间 >0

### 超时测试 (`rpc-timeout.test.ts` — 3 个)

- 慢服务器→超时 reject
- 挂起不阻塞后续（pending map 清理）
- 排队中请求在重连后的行为

---

## 5. 运行

```bash
# 集成测试（15 秒超时）
npm run test:integration

# 完整测试（单元 + 集成 + E2E）
npm run test
```

---

## 6. 关键设计决策

| 决策 | 选项 | 选择理由 |
|------|------|----------|
| Mock server 语言 | 单 `.ts` 文件 | 与项目代码一致，通过 `ts-node/register` 直接运行 |
| 场景选择机制 | 环境变量 `MOCK_SCENARIO` | 避免进程参数冲突（PiRpcClient 总是先加 `--mode rpc`） |
| 进程启动方式 | `process.execPath` + extraArgs | 不依赖系统 PATH，可重复 |
| 测试框架 | Mocha（与单元测试一致） | 统一的学习曲线和配置 |
