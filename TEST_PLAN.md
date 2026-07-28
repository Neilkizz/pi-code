# Pi Code — 测试计划 (TEST_PLAN)

**版本:** 1.0  
**状态:** 正式发布  
**最后更新:** 2026-07-27  

---

## 1. 测试策略总览

Pi Code 采用分层测试策略，覆盖单元测试、集成测试、端到端测试和安全测试。

```
测试金字塔:
      ┌─────┐
     ╱  E2E  ╲          ← 关键用户场景
    ├───────┤
   ╱ Integ.  ╲         ← RPC 协议 + VS Code API
  ├───────────┤
 ╱   Unit      ╲       ← 工具函数、Reducer、队列、行读取器
└───────────────┘
```

---

## 2. 测试覆盖率目标

| 测试类型 | 覆盖率目标 | 当前 |
| --- | --- | --- |
| 单元测试总体 | ≥ 80% | ~70%（已覆盖核心模块） |
| Agent Core 单元 | 分支 ≥ 90% | — |
| SSE 解析器 | 分支 ≥ 95% | lineReader 覆盖充分 |
| 权限模块 | 分支 ≥ 95% | — |
| Provider Contract | 全部通过 | — |

---

## 3. 现有测试

### 3.1 单元测试（31 个，全部通过）

#### JsonlLineReader (`test/unit/lineReader.test.ts` — 12 个)

| # | 场景 | 验证内容 |
| --- | ------ | ---------- |
| 1 | 单行 LF 分隔 | 正确发射单条记录 |
| 2 | 多行 | 正确发射多条记录 |
| 3 | CRLF 处理 | 剥离尾部 \r |
| 4 | U+2028 不分割 | JSON 内 LINE SEPARATOR 不触发分行 |
| 5 | U+2029 不分割 | JSON 内 PARAGRAPH SEPARATOR 不触发分行 |
| 6 | 多字节 UTF-8 边界 | 跨块编码不产生乱码 |
| 7 | Flush 尾行 | 无 LF 结尾的尾行被 flush 发射 |
| 8 | 空行跳过 | 空行不发射 |
| 9 | push(string) 支持 | 直接推字符串而不是 Buffer |
| 10 | 多字节 flush 无替换符 | 尾巴不产生 U+FFFD |
| 11 | Decoder 复用 | 多个 push 周期复用同一 decoder |
| 12 | Handler 异常隔离 | 回调异常不破坏 reader |

#### reduceMessages (`test/unit/reduceMessages.test.ts` — 16 个)

| # | 场景 | 验证内容 |
| --- | ------ | ---------- |
| 1 | 用户消息开始 | 正确创建 user message |
| 2 | 助手消息流式开始 | 创建 streaming assistant message |
| 3 | 消息开始类型 | assistant 从 message_start 正确创建 |
| 4 | text_delta 追加 | 文本增量正确拼接 |
| 5 | thinking_delta | 推理内容进入 thinkingText 而非 text |
| 6 | message_end | 停止 streaming 状态 |
| 7 | tool_execution_start | 设置 running 状态 |
| 8 | tool_execution_update | 局部结果反馈 |
| 9 | tool_execution_end 精确匹配 | 相同 toolCallId 精确匹配 |
| 10 | tool_execution_end 错误 | 错误状态标记 |
| 11 | Compaction 事件 | Start/end 添加 banner |
| 12 | 200 条上限 | 超 200 条自动裁剪 |
| 13 | 用户/助手文本 | convertAgentMessages 正确转换 |
| 14 | 助手含 thinking | thinking block 分离 |
| 15 | Tool call+result 关联 | toolCallId 关联 |
| 16 | compaction/branchSummary | 特殊类型消息 |

#### RequestQueue (`test/unit/requestQueue.test.ts` — 3 个)

| # | 场景 | 验证内容 |
|---|------|----------|
| 1 | FIFO 入队出队 | 顺序正确 |
| 2 | Clear 拒绝全部 | 所有请求被 reject |
| 3 | Remove 特定 ID | 单个请求移除 |

---

## 4. 待添加测试

### 4.1 单元测试优先级

| 优先级 | 模块 | 测试内容 |
| --- | --- | --- |
| P0 | PiRpcClient | start/dispose/restart 生命周期 |
| P0 | PiRpcClient | 请求超时处理 |
| P0 | PiRpcClient | request() 排队和 draining |
| P0 | PiRpcClient | 事件流容错 |
| P0 | SessionManager | create/close/active/fork |
| P0 | SessionManager | 最大并发限制 |
| P0 | SessionManager | persistTabs/restoreSaved |
| P0 | ChatProvider | dispatch 方法全覆盖 |
| P0 | WebviewMessenger | decodeFromWebview 白名单 |
| P1 | DiffController | snapshot/createDiff/accept/revert |
| P1 | AuthService | login/logout/status |
| P1 | PiTerminal | event 转发和 extractText |

### 4.2 集成测试

| 优先级 | 测试内容 |
| --- | --- |
| P0 | RPC 协议 — prompt → 收到 response + agent_start/end |
| P0 | RPC 协议 — U+2028/U+2029 在 JSON 字符串内部不破坏解析 |
| P0 | RPC 协议 — get_state/cycle_model/set_model |
| P0 | RPC 协议 — abort 正确终止进行中请求 |
| P0 | RPC 协议 — 并发请求不串流 |
| P1 | SSE 乱序注入测试（1,000 组乱序/重复/截断事件） |
| P1 | 首字节前重试测试 |
| P1 | 首字节后断流保护测试 |
| P1 | 空流处理测试 |

### 4.3 VS Code 集成测试

| 优先级 | 测试内容 |
| --- | --- |
| P0 | 扩展激活（activationEvents） |
| P0 | Webview 创建和消息传递 |
| P0 | Diff 编辑器打开和交互 |
| P0 | 命令注册和执行 |
| P1 | 设置变更监听 |
| P1 | 状态栏更新 |
| P1 | 主题切换不破坏布局 |

### 4.4 端到端测试

所有关键场景（来自 `交付标准.md` 9.2 节）：

| # | 场景 | 验证内容 |
| --- | ------ | ---------- |
| E-01 | 选中代码引用 | 准确引用文件和行号，解释逻辑 |
| E-02 | 跨三文件功能 | 生成计划→批准→完成修改 |
| E-03 | 自动打开定位 | Agent 编辑时 VS Code 自动打开并定位到修改行 **(必过)** |
| E-04 | 拒绝 Diff Hunk | 拒绝后其余修改可正常接受 |
| E-05 | 用户手工修改 | Diff 中修改后 Agent 读取到用户版本 |
| E-06 | 失败自动修复 | 测试失败→分析→修复→再次通过 |
| E-07 | 权限确认 | 危险命令弹出确认，拒绝后不绕过 |
| E-08 | 503 自动切换 | 流开始前 503，自动切换备用模型 |
| E-09 | 断流保护 | 流开始后中断，保留部分结果，不拼接 |
| E-10 | 拆块 JSON | 工具调用拆成多个 SSE Chunk，最终只执行一次 |
| E-11 | 用户停止 | 模型流、工具调用、子进程全部停止 |
| E-12 | 崩溃恢复 | 异常退出后恢复会话和最后一致检查点 |
| E-13 | 回滚保护 | 回退检查点后用户手工修改不被覆盖 |
| E-14 | 四会话并行 | 不串流、不串消息、不串文件 |
| E-15 | 不可信工作区 | 不执行命令、不自动修改文件 |
| E-16 | API Key 保护 | 不出现在设置/日志/异常/导出中 |
| E-17 | 异常 event 容错 | message_stop 异常不崩溃 |
| E-18 | Remote SSH 命令 | 命令在远端运行 |
| E-19 | MCP 崩溃 | 当前调用失败，主会话可用 |
| E-20 | 10 万文件搜索 | UI 不冻结 |

---

## 5. 测试命令

```bash
# 运行所有单元测试
npm run test:unit

# 运行 RPC 集成冒烟测试（需要 pi CLI）
npm run smoke:rpc

# 运行完整测试套件
npm test

# 运行 VS Code 集成测试（需要 Extension Development Host）
npm run test:e2e
```

### 5.1 测试配置

```json
// test/tsconfig.json — 测试专用 TypeScript 配置
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "rootDir": "..",
    "outDir": "out",
    "types": ["node", "mocha"]
  },
  "include": ["./**/*.ts", "../src/**/*.ts"]
}
```

---

## 6. 测试数据

### 6.1 SSE 乱序测试数据

用于验证 T-001 到 T-012 流式状态机标准：

```json
// 工具调用拆块示例（用于 T-004 工具参数拼接）
{ "id": "test-1", "type": "tool_execution_start", "toolCallId": "tc1", "toolName": "bash", "args": {} }
{ "id": "test-1", "type": "tool_execution_update", "toolCallId": "tc1", "toolName": "bash", "partialResult": { "content": [{ "text": "partial output" }] } }
{ "id": "test-1", "type": "tool_execution_end", "toolCallId": "tc1", "toolName": "bash", "result": { "content": [] }, "isError": false }

// 乱序结束事件（用于 T-003 幂等处理）
{ "id": "dup-end", "type": "agent_end", "messages": [] }
{ "id": "dup-end", "type": "agent_end", "messages": [] }
```

### 6.2 流式状态机测试（T-001 至 T-012）

```
测试 1: 正常流 → message_start → text_delta → message_update → message_end
测试 2: 双工具 → tool1_start → tool2_start → tool1_end → tool2_end
测试 3: 乱序结束 → agent_end 出现两次（幂等处理）
测试 4: 首字节前 503 → 自动切换备用 Provider
测试 5: 首字节后断流 → 保留已收内容，标记未完整
测试 6: 空流 → 首个有效载荷前关闭 → 返回 empty_stream
测试 7: 跨会话事件 → 不污染其他会话状态
```
