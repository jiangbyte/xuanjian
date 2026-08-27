/**
 * @file Agent Harness 模块入口
 * @author Charlie
 */

export { runAgentTurn } from "@/lib/agent/runtime";
export type { RunAgentInput, RuntimeEvent, ConfirmToolRequest } from "@/lib/agent/types";
export { runLocalReAct } from "@/lib/agent/react";
export {
  buildAgentHistory,
  deriveMessages,
  SessionStore,
} from "@/lib/agent/session";
export {
  runReActLoop,
  resolveProvider,
  AgentInbox,
} from "@/lib/agent/agent-loop";
export { useHook, registerDefaultToolHooks } from "@/lib/agent/hooks";
export { compactLlmMessagesForModel } from "@/lib/agent/compaction";
