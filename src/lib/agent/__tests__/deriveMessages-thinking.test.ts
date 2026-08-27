/**
 * @file thinking + tool_call 往返测试
 */

import { describe, expect, it } from "vitest";
import { deriveMessages } from "@/lib/agent/session/deriveMessages";
import { resetSessionSeqCounter } from "@/lib/agent/session/partsMapping";
import type { SessionEvent } from "@/lib/agent/session/types";

describe("deriveMessages thinking persistence", () => {
  it("preserves thinking and synthesizes tool_use for Anthropic replay", () => {
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
    const toolUse = assistant?.anthropic_content?.find((b) => b.type === "tool_use");
    expect(toolUse).toMatchObject({
      type: "tool_use",
      id: "c1",
      name: "ping",
      input: { host: "1.1.1.1" },
    });
    expect(assistant?.tool_calls?.[0]?.id).toBe("c1");
  });

  it("synthesizes tool_use when history only has thinking chunks + tool/call", () => {
    resetSessionSeqCounter(0);
    const events: SessionEvent[] = [
      { type: "user/message", content: "create file", seq: 1 },
      {
        type: "assistant/chunk",
        kind: "thinking",
        text: "plan mkdir",
        seq: 2,
      },
      {
        type: "tool/call",
        id: "call_00_abc",
        name: "write_file",
        args: { path: "test/t.txt" },
        seq: 3,
      },
      {
        type: "tool/result",
        id: "call_00_abc",
        name: "write_file",
        result: '{"ok":false,"blocked":true}',
        seq: 4,
      },
    ];
    const msgs = deriveMessages(events);
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(
      assistant?.anthropic_content?.some(
        (b) => b.type === "tool_use" && b.id === "call_00_abc",
      ),
    ).toBe(true);
    expect(msgs.some((m) => m.role === "tool" && m.tool_call_id === "call_00_abc")).toBe(
      true,
    );
  });
});
