/**
 * @file runToolBatch 与 LoopPolicy 接线
 */

import { describe, expect, it, vi } from "vitest";
import { LoopPolicy } from "../../loop/policy";
import { runToolBatch } from "../batch";
import type { AgentPorts } from "../../ports";
import type { NormalizedLlmReply } from "../../types";

function makeReply(calls: { id: string; name: string; args: object }[]): NormalizedLlmReply {
  return {
    text: "",
    thinking: "",
    toolCalls: calls.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: {
        name: c.name,
        arguments: JSON.stringify(c.args),
      },
    })),
    anthropicContent: undefined,
  };
}

describe("runToolBatch", () => {
  it("skips execute when beforeTool soft-blocks after repeats", async () => {
    const execute = vi.fn(async () =>
      JSON.stringify({ ok: true, progress_digest: "x" }),
    );
    const ports = {
      tools: {
        execute,
        isWriteTool: () => true,
        listTools: () => [],
      },
    } as unknown as AgentPorts;

    const policy = new LoopPolicy({ maxCalls: 50, softBeforeHard: 2 });
    const args = { command: "dup" };

    // Warm up to soft block
    for (let i = 0; i < 2; i++) {
      expect(policy.beforeTool("terminal_run", args).action).toBe("run");
      policy.afterTool(
        "terminal_run",
        args,
        JSON.stringify({ ok: true, progress_digest: `p${i}` }),
      );
    }

    const reply = makeReply([
      { id: "1", name: "terminal_run", args },
      { id: "2", name: "terminal_run", args: { command: "other" } },
    ]);

    const result = await runToolBatch({
      reply,
      messages: [],
      assistantParts: [],
      policy,
      config: {
        ports,
        permissionMode: "full",
        agentTag: "test",
        emit: () => {},
      },
    });

    // First call soft-blocked (3rd identical) → no execute for it
    // Second call different args → may still run unless hard stopped
    const softObs = result.messages.find(
      (m) => m.role === "tool" && m.tool_call_id === "1",
    );
    expect(softObs?.content).toBeTruthy();
    expect(String(softObs?.content)).not.toContain('"progress_digest":"x"');
  });
});
