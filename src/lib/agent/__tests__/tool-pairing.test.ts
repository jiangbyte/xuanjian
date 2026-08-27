/**
 * @file tool-pairing 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  alignKeepFromBalanced,
  isToolPairingBalancedBefore,
  sanitizeLlmMessagesForApi,
  stripLeadingOrphanTools,
} from "@/lib/agent/compaction/tool-pairing";
import { applyCompactionToMessages } from "@/lib/agent/compaction/summarize";
import type { LlmMessage } from "@/lib/agent/llm";

describe("tool-pairing", () => {
  it("detects unbalanced cut inside tool batch", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "u1" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "a", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "r1" },
      { role: "user", content: "u2" },
    ];
    expect(isToolPairingBalancedBefore(messages, 2)).toBe(false);
    expect(isToolPairingBalancedBefore(messages, 3)).toBe(true);
    expect(alignKeepFromBalanced(messages, 2)).toBe(1);
  });

  it("strips leading orphan tool results", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: "<compacted-summary>\nold\n</compacted-summary>",
      },
      { role: "tool", tool_call_id: "orphan", content: "lost" },
      { role: "user", content: "continue" },
    ];
    const out = stripLeadingOrphanTools(messages, 2);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(out[out.length - 1].content).toBe("continue");
  });

  it("compaction result has no orphan tools at tail start", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "analyze disk" },
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
        content: "x".repeat(3000),
      },
      {
        role: "tool",
        tool_call_id: "c2",
        name: "shell",
        content: "y".repeat(3000),
      },
      { role: "user", content: "next" },
    ];
    const out = applyCompactionToMessages(messages, "checkpoint", 0.16);
    const sanitized = sanitizeLlmMessagesForApi(out);
    const firstNonSystem = sanitized.findIndex((m) => m.role !== "system");
    for (let i = firstNonSystem; i < sanitized.length; i++) {
      const m = sanitized[i];
      if (m.role !== "tool") break;
      const id = m.tool_call_id ?? "";
      const prior = sanitized.slice(0, i);
      const hasUse = prior.some(
        (m) =>
          m.role === "assistant" && m.tool_calls?.some((tc) => tc.id === id),
      );
      expect(hasUse).toBe(true);
    }
  });
});
