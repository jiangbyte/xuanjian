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

export { AGENT_LIMITS, REACT_LIMITS } from "./limits";

export { LoopPolicy, defaultResultSignature } from "./loop";
export type {
  AfterToolDecision,
  BeforeToolDecision,
  LoopPolicyOptions,
  StopReason,
} from "./loop";

export {
  buildPlanExecutePrompt,
  splitPlanFromReply,
} from "./plan";

export { normalizeSubAgentArgs, parseArgs } from "./parse-tool-args";

export { runToolBatch } from "./tools/batch";
export type {
  ToolBatchConfig,
  ToolBatchInput,
  ToolBatchResult,
} from "./tools/batch";

/** 图运行时请从 `@xuanjian/agent-core/graph` 导入，避免 UI 无谓加载 LangGraph */
export type { OrchestratorConfig, AgentGraphState } from "./graph";
