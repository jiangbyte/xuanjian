/**
 * @file 流式 tool_calls 与 SubAgent 参数测试
 */

import { describe, expect, it } from "vitest";
import {
  normalizeSubAgentArgs,
  parseArgs,
} from "@xuanjian/agent-core";
import { mergeStreamToolCallDeltas } from "@/lib/agent/llm/stream-tool-calls";

describe("mergeStreamToolCallDeltas", () => {
  it("merges OpenAI streaming tool_call fragments by index", () => {
    const acc = new Map();
    mergeStreamToolCallDeltas(acc, [
      {
        index: 0,
        id: "call_abc",
        function: { name: "run_subagent", arguments: "" },
      },
    ]);
    const merged = mergeStreamToolCallDeltas(acc, [
      {
        index: 0,
        function: {
          arguments:
            '{"agent":"terminal","task":"在根分区执行 du -xh --max-depth=1 /"}',
        },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].function.name).toBe("run_subagent");
    const args = JSON.parse(merged[0].function.arguments);
    expect(args.agent).toBe("terminal");
    expect(args.task).toContain("du");
  });
});

describe("normalizeSubAgentArgs", () => {
  it("reads agent and task from standard keys", () => {
    expect(
      normalizeSubAgentArgs({
        agent: "terminal",
        task: "scan disk",
      }),
    ).toEqual({ agent: "terminal", task: "scan disk" });
  });

  it("accepts common aliases", () => {
    expect(
      normalizeSubAgentArgs({
        subagent: "inspector",
        instruction: "list sessions",
      }),
    ).toEqual({ agent: "inspector", task: "list sessions" });
  });
});

describe("parseArgs", () => {
  it("parses JSON string", () => {
    expect(parseArgs('{"a":1}')).toEqual({ a: 1 });
  });

  it("passes through object", () => {
    expect(parseArgs({ agent: "terminal" })).toEqual({ agent: "terminal" });
  });
});
