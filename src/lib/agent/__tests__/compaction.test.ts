/**
 * @file compaction 策略测试
 */

import { describe, expect, it } from "vitest";
import { applyCompactionToMessages } from "@/lib/agent/compaction/summarize";
import type { LlmMessage } from "@/lib/agent/llm";

describe("applyCompactionToMessages", () => {
  it("replaces old tool messages with summary", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "tool", tool_call_id: "a", content: "r1" },
      { role: "tool", tool_call_id: "b", content: "r2" },
      { role: "tool", tool_call_id: "c", content: "r3" },
    ];
    const out = applyCompactionToMessages(messages, "summary", 0.16);
    const summaryMsg = out.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("summary"),
    );
    expect(summaryMsg).toBeTruthy();
    expect(out.filter((m) => m.role === "tool").length).toBeLessThan(3);
  });
});
