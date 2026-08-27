/**
 * @file thinking + tool_call 往返测试
 */

import { describe, expect, it } from "vitest";
import { deriveMessages } from "@/lib/agent/session/deriveMessages";
import { resetSessionSeqCounter } from "@/lib/agent/session/partsMapping";
import type { SessionEvent } from "@/lib/agent/session/types";

describe("deriveMessages thinking persistence", () => {
  it("preserves thinking in anthropic_content on tool assistant flush", () => {
    resetSessionSeqCounter(0);
    const events: SessionEvent[] = [
      { type: "user/message", content: "check host", seq: 1 },
      {
        type: "assistant/message",
        thinking: "need to ping first",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "ping", arguments: '{"host":"1.1.1.1"}' },
          },
        ],
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
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant?.anthropic_content?.some((b) => b.type === "thinking")).toBe(
      true,
    );
  });
});
