/**
 * @file LlmMessage 序列上的 tool-call / tool-result 配对平衡（对齐 dsh tool-pairing）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";

/** 处理 messages[0..cutBefore) 后未闭合的 tool call 数量 */
export function inProgressToolCalls(
  messages: LlmMessage[],
  cutBefore: number,
): number {
  let open = 0;
  for (let i = 0; i < cutBefore; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      open += m.tool_calls.length;
    } else if (m.role === "tool") {
      open -= 1;
      if (open < 0) return -1;
    }
  }
  return open;
}

/** cut 在 msgIdx 处是否平衡（无未闭合 tool call 跨越边界） */
export function isToolPairingBalancedBefore(
  messages: LlmMessage[],
  msgIdx: number,
): boolean {
  return inProgressToolCalls(messages, msgIdx) === 0;
}

/** 将 keepFrom 前移直到切分边界平衡 */
export function alignKeepFromBalanced(
  messages: LlmMessage[],
  keepFrom: number,
): number {
  let idx = Math.max(0, Math.min(keepFrom, messages.length));
  while (idx > 0 && !isToolPairingBalancedBefore(messages, idx)) {
    idx -= 1;
  }
  return idx;
}

/** 去掉尾部保留区开头无对应 tool_use 的孤儿 tool 消息 */
export function stripLeadingOrphanTools(
  messages: LlmMessage[],
  fromIdx: number,
): LlmMessage[] {
  const head = messages.slice(0, fromIdx);
  const tail: LlmMessage[] = [];
  for (const m of messages.slice(fromIdx)) {
    if (m.role !== "tool") {
      tail.push(m);
      continue;
    }
    const id = m.tool_call_id ?? "";
    const hasUse = head.some(
      (h) =>
        h.role === "assistant" &&
        h.tool_calls?.some((tc) => tc.id === id),
    );
    if (hasUse) {
      tail.push(m);
      continue;
    }
    // 也检查 tail 中已保留的 assistant
    const hasUseInTail = tail.some(
      (h) =>
        h.role === "assistant" &&
        h.tool_calls?.some((tc) => tc.id === id),
    );
    if (hasUseInTail) tail.push(m);
  }
  return [...head, ...tail];
}

/** 发送 API 前修复：去孤儿 tool、保证 assistant+tool 块完整 */
export function sanitizeLlmMessagesForApi(
  messages: LlmMessage[],
): LlmMessage[] {
  let out = [...messages];

  // 去掉开头孤儿 tool
  while (out.length > 0 && out[0].role === "tool") {
    const id = out[0].tool_call_id ?? "";
    const hasUse = out.some(
      (m, i) =>
        i > 0 &&
        m.role === "assistant" &&
        m.tool_calls?.some((tc) => tc.id === id),
    );
    if (hasUse) break;
    out = out.slice(1);
  }

  // 去掉末尾未闭合的 assistant tool_calls（无后续 tool 结果）
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.role !== "assistant" || !last.tool_calls?.length) break;
    const ids = new Set(last.tool_calls.map((tc) => tc.id));
    let answered = 0;
    for (const m of out) {
      if (m.role === "tool" && ids.has(m.tool_call_id ?? "")) answered += 1;
    }
    if (answered >= ids.size) break;
    out = out.slice(0, -1);
  }

  return out;
}
