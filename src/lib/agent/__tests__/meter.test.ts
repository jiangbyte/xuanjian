/**
 * @file 上下文投影公式测试
 */

import { describe, expect, it } from "vitest";
import {
  BLOCK_OVERHEAD,
  ROLE_OVERHEAD,
  estimateSystemTokens,
  estimateTokens,
  estimateToolsTokens,
} from "@/lib/agent/contextBudget";
import {
  buildContextMeterView,
  projectedTokensFromSample,
} from "@/lib/agent/contextBudget/meter";
import { measureLlmMessageTokens } from "@/lib/agent/contextBudget/projected";

describe("dsh-aligned estimateTokens", () => {
  it("uses fixed 4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateSystemTokens("abcd")).toBe(1 + ROLE_OVERHEAD);
    expect(estimateToolsTokens([])).toBe(0);
    const tools = [
      {
        type: "function" as const,
        function: { name: "a", description: "", parameters: {} },
      },
    ];
    const raw = JSON.stringify(tools);
    expect(estimateToolsTokens(tools)).toBe(
      Math.ceil(raw.length / 4) + BLOCK_OVERHEAD,
    );
  });

  it("prices messages with role + block overhead", () => {
    expect(measureLlmMessageTokens({ role: "user", content: "hello" })).toBe(
      ROLE_OVERHEAD + Math.ceil(5 / 4) + BLOCK_OVERHEAD,
    );
  });
});

describe("projectedTokensFromSample", () => {
  it("uses surface estimate when no API sample", () => {
    expect(projectedTokensFromSample({ surfaceTokens: 12_000 })).toBe(12_000);
  });

  it("adds surface delta after API sample (dsh formula)", () => {
    expect(
      projectedTokensFromSample({
        surfaceTokens: 12_000,
        pressureTokens: 9_500,
        sampledSurfaceTokens: 10_000,
      }),
    ).toBe(11_500);
  });

  it("drops immediately after compaction shrinks surface", () => {
    expect(
      projectedTokensFromSample({
        surfaceTokens: 5_000,
        pressureTokens: 9_500,
        sampledSurfaceTokens: 10_000,
      }),
    ).toBe(4_500);
  });
});

describe("buildContextMeterView", () => {
  it("breakdown components do not need to equal projected total", () => {
    const view = buildContextMeterView({
      system: "sys",
      tools: [
        {
          type: "function",
          function: { name: "a", description: "", parameters: {} },
        },
      ],
      messages: [
        { role: "user", content: "hello" },
        { role: "tool", tool_call_id: "c1", content: "x".repeat(5000) },
      ],
      contextTag: "128k",
      lastUsage: {
        input: 8000,
        output: 200,
        totalPrompt: 8000,
      },
      sampledSurfaceTokens: 9000,
    });
    const composition =
      view.systemTokens + view.toolsTokens + view.messageTokens;
    expect(view.projectedTokens).toBeGreaterThan(0);
    expect(composition).not.toBe(view.projectedTokens);
    expect(view.pressureTokens).toBe(8000);
  });
});
