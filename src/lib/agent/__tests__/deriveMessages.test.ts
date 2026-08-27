/**
 * @file deriveMessages 单元测试
 */

import { describe, expect, it } from "vitest";
import { deriveMessages } from "@/lib/agent/history/deriveMessages";
import { resetSessionSeqCounter } from "@/lib/agent/history/partsMapping";
import type { SessionEvent } from "@/lib/agent/history/types";

describe("deriveMessages", () => {
  it("projects user and assistant text", () => {
    resetSessionSeqCounter(0);
    const events: SessionEvent[] = [
      { type: "user/message", content: "hello", seq: 1 },
      {
        type: "assistant/chunk",
        kind: "text",
        text: "hi",
        seq: 2,
      },
    ];
    const msgs = deriveMessages(events);
    expect(msgs).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("rebuilds tool call chain", () => {
    resetSessionSeqCounter(0);
    const events: SessionEvent[] = [
      { type: "user/message", content: "ping host", seq: 1 },
      {
        type: "tool/call",
        id: "c1",
        name: "ping",
        args: { host: "1.1.1.1" },
        seq: 2,
      },
      {
        type: "tool/result",
        id: "c1",
        name: "ping",
        result: '{"ok":true}',
        seq: 3,
      },
    ];
    const msgs = deriveMessages(events);
    expect(msgs).toHaveLength(3);
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2]).toMatchObject({
      role: "tool",
      tool_call_id: "c1",
      content: '{"ok":true}',
    });
  });

  it("includes compaction as user summary", () => {
    resetSessionSeqCounter(0);
    const events: SessionEvent[] = [
      { type: "compaction", summary: "earlier context", seq: 1 },
      { type: "user/message", content: "continue", seq: 2 },
    ];
    const msgs = deriveMessages(events);
    expect(msgs[0].content).toContain("earlier context");
  });
});
