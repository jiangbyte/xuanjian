/**
 * @file stream reduceParts 单元测试
 */

import { describe, expect, it } from "vitest";
import { reduceParts } from "@/features/agent/stream/reduceParts";
import type { MessagePart } from "@/lib/db";

describe("reduceParts", () => {
  it("merges consecutive thinking_delta into one part", () => {
    let parts: MessagePart[] = [];
    parts = reduceParts(parts, {
      type: "thinking_delta",
      text: "hello ",
      agent: "orchestrator",
    });
    parts = reduceParts(parts, {
      type: "thinking_delta",
      text: "world",
      agent: "orchestrator",
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "thinking",
      text: "hello world",
    });
  });

  it("nests inspector deltas under running subagent", () => {
    let parts: MessagePart[] = [
      {
        type: "subagent",
        id: "s1",
        agent: "inspector",
        label: "巡检",
        task: "disk",
        status: "running",
        children: [],
      },
    ];
    parts = reduceParts(parts, {
      type: "thinking_delta",
      text: "scan",
      agent: "inspector",
    });
    parts = reduceParts(parts, {
      type: "thinking_delta",
      text: "ning",
      agent: "inspector",
    });
    const sub = parts[0];
    expect(sub.type).toBe("subagent");
    if (sub.type === "subagent") {
      expect(sub.children).toHaveLength(1);
      expect(sub.children?.[0]).toMatchObject({
        type: "thinking",
        text: "scanning",
      });
    }
  });

  it("upserts tool_call by id", () => {
    let parts: MessagePart[] = [];
    parts = reduceParts(parts, {
      type: "tool_call",
      id: "t1",
      name: "list_files",
      args: { path: "/" },
    });
    parts = reduceParts(parts, {
      type: "tool_call",
      id: "t1",
      name: "list_files",
      args: { path: "/tmp" },
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "tool_call",
      args: { path: "/tmp" },
    });
  });
});
