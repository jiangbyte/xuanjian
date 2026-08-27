/**
 * @file Agent 模块入口
 */

export { runAgentTurn } from "@xuanjian/agent-adapters";
export {
  steerAgent,
  buildPlanExecutePrompt,
  splitPlanFromReply,
  REACT_LIMITS,
  ReactLoopGuard,
} from "@xuanjian/agent-core";
export type {
  RunAgentInput,
  RuntimeEvent,
  ConfirmToolRequest,
  AgentActivityPhase,
} from "@xuanjian/agent-core";
export { buildAgentHistory, deriveMessages } from "@/lib/agent/session";
export { useHook, registerDefaultToolHooks } from "@/lib/agent/hooks";
export { compactLlmMessagesForModel } from "@/lib/agent/compaction";
export { resolveProvider } from "@/lib/agent/provider";
export type { ProviderBundle } from "@/lib/agent/provider";
