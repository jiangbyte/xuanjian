/**
 * @file driver 溢出压缩重试测试
 */

import { describe, expect, it } from "vitest";
import { isContextOverflowError } from "@/lib/agent/compaction/pressure";
import { applyCompactionToMessages } from "@/lib/agent/compaction/summarize";
import type { LlmMessage } from "@/lib/agent/llm";

describe("isContextOverflowError", () => {
  it("detects context length errors", () => {
    expect(isContextOverflowError(new Error("context length exceeded"))).toBe(
      true,
    );
    expect(isContextOverflowError(new Error("maximum context tokens"))).toBe(
      true,
    );
    expect(isContextOverflowError(new Error("network timeout"))).toBe(false);
  });
});

describe("overflow compaction path", () => {
  it("force retainRatio compacts aggressively", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "u1" },
      { role: "tool", tool_call_id: "a", content: "r1".repeat(2000) },
      { role: "tool", tool_call_id: "b", content: "r2".repeat(2000) },
      { role: "tool", tool_call_id: "c", content: "r3".repeat(2000) },
      { role: "user", content: "tail" },
    ];
    const out = applyCompactionToMessages(messages, "overflow checkpoint", 0);
    expect(
      out.some(
        (m) =>
          typeof m.content === "string" && m.content.includes("overflow checkpoint"),
      ),
    ).toBe(true);
  });
});
