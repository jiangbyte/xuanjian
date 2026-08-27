/**
 * @file @xuanjian/agent-core 公开 API
 */

export type {
  AgentActivityPhase,
  AgentPermissionMode,
  ConfirmToolRequest,
  CoreLlmMessage,
  CoreLlmToolCall,
  CoreToolDef,
  ExecutionSnapshot,
  LlmUsage,
  MessagePart,
  NormalizedLlmReply,
  RunAgentInput,
  RuntimeEvent,
  ThinkingMode,
} from "./types";

export type {
  AgentPorts,
  ExecutionContextPort,
  LlmPort,
  LlmRequestOpts,
  ProviderPort,
  SessionPort,
  StreamCallbacks,
  ToolPort,
} from "./ports";

export {
  AgentInbox,
  clearSessionInbox,
  getSessionInbox,
  steerAgent,
} from "./inbox";

export { REACT_LIMITS, ReactLoopGuard, isReadOnlyAgentTool, toolCallSignature } from "./guards";
export type { GuardStopReason } from "./guards";

export {
  buildPlanExecutePrompt,
  splitPlanFromReply,
} from "./plan";

export { normalizeSubAgentArgs, parseArgs } from "./parse-tool-args";

/** 图运行时请从 `@xuanjian/agent-core/graph` 导入，避免 UI 无谓加载 LangGraph */
export type { OrchestratorConfig, AgentGraphState } from "./graph";
