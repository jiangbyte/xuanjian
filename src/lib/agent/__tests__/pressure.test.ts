/**
 * @file 上下文压力测试
 */

import { describe, expect, it } from "vitest";
import { buildContextPressure } from "@/lib/agent/contextBudget/projected";
import type { LlmMessage } from "@/lib/agent/llm";

describe("buildContextPressure", () => {
  it("counts tool messages toward projected tokens", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "run checks" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "shell", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "c1",
        name: "shell",
        content: "x".repeat(80_000),
      },
    ];
    const withoutTools = buildContextPressure({
      system: "sys",
      tools: [],
      messages: [{ role: "user", content: "run checks" }],
      contextTag: "8k",
    });
    const withTools = buildContextPressure({
      system: "sys",
      tools: [],
      messages,
      contextTag: "8k",
    });
    expect(withTools.projected).toBeGreaterThan(withoutTools.projected);
    expect(withTools.overThreshold).toBe(true);
  });
});
