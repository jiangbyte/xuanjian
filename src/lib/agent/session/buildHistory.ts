/**
 * @file 从 SQLite 会话构建 LLM 历史
 * @author Charlie
 */

import { deriveMessages } from "@/lib/agent/session/deriveMessages";
import { messageRowToEvents, resetSessionSeqCounter } from "@/lib/agent/session/partsMapping";
import type { LlmMessage } from "@/lib/agent/llm";
import {
  listAgentMessages,
  parseMessageParts,
  type AgentMessageRow,
} from "@/lib/db";

/** 将持久化消息行重放为事件并投影为 LLM 消息（不含 system） */
export function buildHistoryFromMessageRows(
  rows: AgentMessageRow[],
): LlmMessage[] {
  resetSessionSeqCounter(0);
  const events = rows.flatMap((row) => {
    const parts = parseMessageParts(row.parts_json);
    if (row.role === "user" || row.role === "assistant") {
      return messageRowToEvents(row.role, parts);
    }
    return [];
  });
  return deriveMessages(events);
}

/** 按 sessionId 读取完整多轮历史 */
export async function buildAgentHistory(
  sessionId: number,
): Promise<LlmMessage[]> {
  const rows = await listAgentMessages(sessionId);
  return buildHistoryFromMessageRows(rows);
}
