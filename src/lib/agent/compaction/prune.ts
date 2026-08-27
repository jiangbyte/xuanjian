/**
 * @file 无 LLM 成本的旧 tool 结果裁剪
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import { estimateTokens } from "@/lib/agent/contextBudget";
import { selectCompactableRange } from "@/lib/agent/compaction/region";

const HEAD_CHARS = 1200;
const TAIL_CHARS = 1200;

function pruneToolContent(content: string): string {
  if (content.length <= HEAD_CHARS + TAIL_CHARS + 80) return content;
  return `${content.slice(0, HEAD_CHARS)}\n…(已裁剪 ${content.length} 字符)…\n${content.slice(-TAIL_CHARS)}`;
}

/** 对可压缩区间内旧 tool 消息做 head/tail 截断 */
export function pruneOldToolResults(messages: LlmMessage[]): LlmMessage[] {
  const range = selectCompactableRange(messages, { retainRatio: 0.2 });
  if (!range) return messages;

  return messages.map((m, i) => {
    if (m.role !== "tool") return m;
    if (i < range.start || i >= range.keepFrom) return m;
    if (typeof m.content !== "string") return m;
    if (estimateTokens(m.content) < 800) return m;
    return { ...m, content: pruneToolContent(m.content) };
  });
}
