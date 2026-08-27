# Agent 迁移 Breaking Changes

## 移除：远程 Agent

- 删除 `packages/agent-server`
- 删除 `remoteClient.ts`、`remote_agents` 表
- `agent_sessions` 不再包含 `runtime` / `remote_agent_id` / `remote_backend_session_id`
- 删除设置项 `agent.gateway_port`、`agent.default_runtime`
- UI 不再提供「远程 Agent」选择与发现按钮
- `RunAgentInput` 不再包含 `runtime` / `remoteAgentId`

## 包边界

| 旧路径 | 新路径 |
|--------|--------|
| `src/lib/agent/agent-loop/driver.ts` | `@xuanjian/agent-core` OrchestratorGraph |
| `src/lib/agent/runtime.ts` | `@xuanjian/agent-core` `runAgentTurn` |
| `src/lib/agent/tools/*` | `@xuanjian/agent-adapters` ToolPort |
| `AiChatPanel` 内联 stream reducer | `src/features/agent/stream/reduceParts.ts` |

## 无双轨兼容

旧 ReAct `driver.ts` / `tool-calls.ts` / `reactGuards.ts` / `runtime` 兼容层已删除。  
唯一运行时：`@xuanjian/agent-adapters` → `runAgentTurn` → LangGraph `OrchestratorGraph`。
