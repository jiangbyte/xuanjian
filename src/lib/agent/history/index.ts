/**
 * @file Agent 对话历史：UI 消息 ↔ LLM 上下文
 */

export { buildAgentHistory, buildHistoryFromMessageRows } from "./buildHistory";
export { deriveMessages } from "./deriveMessages";
export {
  messageRowToEvents,
  partsToSessionEvents,
  resetSessionSeqCounter,
  sessionEventsToParts,
  toLlmToolCall,
} from "./partsMapping";
export type { DeriveMessagesOptions, SessionEvent } from "./types";
