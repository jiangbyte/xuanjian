/**
 * @file Agent 运行限额（环路阈值由 agent-loop-guard 负责）
 */

export const AGENT_LIMITS = {
  ORCH_MAX_ROUNDS: 32,
  ORCH_MAX_TOOL_CALLS: 150,
  SUB_MAX_ROUNDS: 24,
  SUB_MAX_TOOL_CALLS: 40,
  MAX_WALL_MS: 60 * 60 * 1000,
  LLM_TIMEOUT_MS: 8 * 60 * 1000,
  MAX_EMPTY_ROUNDS: 3,
} as const;

/** @deprecated 使用 AGENT_LIMITS */
export const REACT_LIMITS = AGENT_LIMITS;
