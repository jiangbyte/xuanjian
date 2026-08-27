/**
 * @file 流式 tool_calls delta 按 index 合并
 * @author Charlie
 */

import type { LlmToolCall } from "@/lib/agent/llm";

/** OpenAI SSE 分片 tool_calls 合并为完整调用 */
export function mergeStreamToolCallDeltas(
  acc: Map<number, LlmToolCall>,
  raw: unknown,
): LlmToolCall[] {
  if (!Array.isArray(raw)) {
    return [...acc.values()].map(finalizeToolCall);
  }
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const idx = typeof t.index === "number" ? t.index : i;
    const cur =
      acc.get(idx) ??
      ({
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      } satisfies LlmToolCall);
    if (t.id) cur.id += t.id;
    if (t.function?.name) cur.function.name += t.function.name;
    if (t.function?.arguments) cur.function.arguments += t.function.arguments;
    acc.set(idx, cur);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => finalizeToolCall(v));
}

function finalizeToolCall(tc: LlmToolCall): LlmToolCall {
  return {
    ...tc,
    id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments || "{}",
    },
  };
}
