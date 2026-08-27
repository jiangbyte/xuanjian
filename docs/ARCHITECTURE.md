# 玄鉴 Agent 架构

## 分层

```
App UI (src/features/agent, AiChatPanel)
  → @xuanjian/agent-core   LangGraph 编排、端口、压缩、Guard
  → @xuanjian/agent-adapters  Tauri LLM / Tools / DB / ExecutionContext
  → Tauri Rust             LLM HTTP 代理、终端、SFTP、网络
```

## 原则

- `agent-core` 禁止依赖 React、Zustand、`@/lib/tauri`、`src/features/*`、`src/stores/*`
- 桌面 I/O 一律经 adapters 注入（端口接口）
- UI 通过稳定的 `RuntimeEvent` 协议消费流式输出
- 仅本地运行时；不包含远程 Agent 后端

## LangGraph 节点

| 节点 | 职责 |
|------|------|
| `preStep` | Inbox/steer、compaction、guard 检查 |
| `callModel` | 流式 LLM 调用 |
| `executeTools` | 工具批执行（含 confirm interrupt） |
| `subAgent` | 派发 inspector/terminal 等子图 |
| `finalize` | 优雅收尾、计划模式提取 |

## 事件协议

见 `@xuanjian/agent-core` 的 `RuntimeEvent`：`thinking_delta` / `text_delta` / `tool_call` / `tool_pending` / `tool_result` / `plan` / `subagent_*` / `usage` / `done`。
