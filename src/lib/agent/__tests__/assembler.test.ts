/**
 * @file BlockAssembler 流式 delta 组装测试
 */

import { describe, expect, it } from "vitest";
import { BlockAssembler } from "@/lib/agent/llm/assembler";

describe("BlockAssembler", () => {
  it("assembles thinking and text deltas", () => {
    const asm = new BlockAssembler();
    asm.pushThinking("step 1");
    asm.pushThinking(" step 2");
    asm.pushText("hello");
    asm.pushText(" world");
    const out = asm.finalize("openai", false);
    expect(out.thinking).toBe("step 1 step 2");
    expect(out.text).toBe("hello world");
    expect(out.anthropicContent?.length).toBeGreaterThan(0);
  });

  it("strips thinking when requested", () => {
    const asm = new BlockAssembler();
    asm.pushThinking("hidden");
    asm.pushText("visible");
    const out = asm.finalize("openai", true);
    expect(out.thinking).toBe("");
    expect(out.text).toBe("visible");
  });
});
