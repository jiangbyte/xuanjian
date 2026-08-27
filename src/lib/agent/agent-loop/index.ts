/**
 * @file agent-loop 模块导出
 * @author Charlie
 */

export { runReActLoop, AgentInbox } from "@/lib/agent/agent-loop/driver";
export { resolveProvider } from "@/lib/agent/agent-loop/provider";
export type { ProviderBundle } from "@/lib/agent/agent-loop/provider";
export type { AgentHandle, LoopOpts, StepEmit } from "@/lib/agent/agent-loop/types";
export { createAgentScope, disposeAgentScope } from "@/lib/agent/agent-loop/scope";
export type { AgentScope } from "@/lib/agent/agent-loop/scope";
export { isConcurrencySafe } from "@/lib/agent/agent-loop/concurrency";
export { runToolCallsBatch } from "@/lib/agent/agent-loop/tool-calls";
