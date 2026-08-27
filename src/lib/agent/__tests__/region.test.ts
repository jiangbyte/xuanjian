/**
 * @file 压缩区间选择测试
 */

import { describe, expect, it } from "vitest";
import { selectCompactableRange } from "@/lib/agent/compaction/region";
import type { LlmMessage } from "@/lib/agent/llm";

describe("selectCompactableRange", () => {
  it("does not split assistant tool_calls from tool results", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "tool", tool_call_id: "a", content: "old".repeat(500) },
      { role: "tool", tool_call_id: "b", content: "old2".repeat(500) },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c",
            type: "function",
            function: { name: "ping", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "c", content: "fresh result" },
      { role: "user", content: "u2" },
    ];
    const range = selectCompactableRange(messages, { retainRatio: 0.16 });
    expect(range).not.toBeNull();
    const kept = messages.slice(range!.keepFrom);
    const assistantIdx = kept.findIndex(
      (m) => m.role === "assistant" && m.tool_calls?.length,
    );
    if (assistantIdx >= 0) {
      const next = kept[assistantIdx + 1];
      expect(next?.role).toBe("tool");
      if (next?.role === "tool") {
        expect(next.tool_call_id).toBe("c");
      }
    }
  });
});
