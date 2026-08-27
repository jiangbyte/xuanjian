/**
 * @file 压缩范围选择（尊重 tool-call / tool-result 配对）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import { measureLlmMessageTokens } from "@/lib/agent/contextBudget/projected";
import {
  alignKeepFromBalanced,
  isToolPairingBalancedBefore,
} from "@/lib/agent/compaction/tool-pairing";

export type CompactRange = {
  start: number;
  end: number;
  keepFrom: number;
};

/** 从尾部保留 retainRatio token，返回可压缩区间 [start, keepFrom) */
export function selectCompactableRange(
  messages: LlmMessage[],
  opts: { retainRatio?: number; contextLimit?: number } = {},
): CompactRange | null {
  const retainRatio = opts.retainRatio ?? 0.16;
  const nonSystem = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role !== "system");
  if (nonSystem.length < 4) return null;

  const tokens = nonSystem.map(({ m }) => measureLlmMessageTokens(m));
  const total = tokens.reduce((a, b) => a + b, 0);
  const retainBudget = Math.max(
    measureLlmMessageTokens(nonSystem[nonSystem.length - 1].m),
    Math.floor(total * retainRatio),
  );

  let kept = 0;
  let keepFromNonSystemIdx = nonSystem.length;
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    kept += tokens[i];
    keepFromNonSystemIdx = i;
    if (kept >= retainBudget) break;
  }

  let keepFrom = nonSystem[keepFromNonSystemIdx].i;
  keepFrom = alignKeepFromBalanced(messages, keepFrom);
  if (keepFrom <= 0) return null;

  const start = nonSystem[0].i;

  if (!isToolPairingBalancedBefore(messages, start)) return null;
  if (!isToolPairingBalancedBefore(messages, keepFrom)) return null;

  const end = keepFrom > start ? keepFrom - 1 : start;
  const endMsg = messages[end];
  if (
    endMsg?.role === "assistant" &&
    endMsg.tool_calls?.length &&
    !isToolPairingBalancedBefore(messages, end + 1)
  ) {
    return null;
  }

  if (keepFrom <= start) return null;

  return { start, end, keepFrom };
}
