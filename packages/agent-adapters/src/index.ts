/**
 * @file @xuanjian/agent-adapters 公开 API
 */

export {
  createTauriLlmPort,
  resolveAndCacheProvider,
} from "./llm/TauriLlmPort";
export { toCoreMessages, toolCallsFromReply } from "./llm/messageAdapter";
export { createTauriToolPort } from "./tools/TauriToolPort";
export {
  domainOfTool,
  toolsByDomain,
  toCoreToolDefs,
  withPlanModeGuard,
  getAllTools,
  isWriteTool,
} from "./tools/registry";
export type { ToolDomain } from "./tools/registry";
export {
  createExecutionContextPort,
  createProviderPort,
  createSessionPort,
} from "./session/ports";
export { createDefaultPorts, runAgentTurn } from "./runLocalTurn";
