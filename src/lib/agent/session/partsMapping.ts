/**
 * @file MessagePart 与 SessionEvent 双向映射
 * @author Charlie
 */

import type { LlmToolCall } from "@/lib/agent/llm";
import type { MessagePart } from "@/lib/db";
import type { SessionEvent } from "@/lib/agent/session/types";

let seqCounter = 0;

function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

/** 重置序号（测试用） */
export function resetSessionSeqCounter(n = 0): void {
  seqCounter = n;
}

/** 持久化的 user/assistant 消息 → 事件流 */
export function messageRowToEvents(
  role: "user" | "assistant",
  parts: MessagePart[],
): SessionEvent[] {
  const events: SessionEvent[] = [];
  if (role === "user") {
    const text = parts
      .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) {
      events.push({ type: "user/message", content: text, seq: nextSeq() });
    }
    return events;
  }

  let lastThinking = "";
  for (const p of parts) {
    switch (p.type) {
      case "thinking":
        lastThinking = p.text;
        events.push({
          type: "assistant/chunk",
          kind: "thinking",
          text: p.text,
          agent: p.agent,
          seq: nextSeq(),
        });
        break;
      case "text":
        events.push({
          type: "assistant/chunk",
          kind: "text",
          text: p.text,
          agent: p.agent,
          seq: nextSeq(),
        });
        break;
      case "tool_call": {
        const think = p.thinkingBefore ?? lastThinking;
        if (think) {
          events.push({
            type: "assistant/chunk",
            kind: "thinking",
            text: think,
            agent: p.agent,
            seq: nextSeq(),
          });
        }
        lastThinking = "";
        events.push({
          type: "tool/call",
          id: p.id,
          name: p.name,
          args: p.args,
          agent: p.agent,
          seq: nextSeq(),
        });
        break;
      }
      case "tool_result":
        events.push({
          type: "tool/result",
          id: p.id,
          name: p.name,
          result: p.result,
          agent: p.agent,
          seq: nextSeq(),
        });
        break;
      case "subagent":
        events.push({
          type: "subagent/start",
          id: p.id,
          agent: p.agent,
          label: p.label,
          task: p.task,
          seq: nextSeq(),
        });
        if (p.status !== "running") {
          events.push({
            type: "subagent/end",
            id: p.id,
            agent: p.agent,
            label: p.label,
            ok: p.status === "done",
            summary: p.summary ?? "",
            children: p.children,
            seq: nextSeq(),
          });
        }
        break;
      case "compaction":
        events.push({
          type: "compaction",
          summary: p.summary,
          seq: nextSeq(),
        });
        break;
      case "plan":
      case "status":
      case "tool_pending":
        break;
    }
  }
  return events;
}

/** 单轮 assistant parts → 事件（循环结束时落库） */
export function partsToSessionEvents(parts: MessagePart[]): SessionEvent[] {
  return messageRowToEvents("assistant", parts);
}

/** 事件流 → UI MessagePart（用于持久化） */
export function sessionEventsToParts(events: SessionEvent[]): MessagePart[] {
  const parts: MessagePart[] = [];
  const subagentMap = new Map<
    string,
    Extract<MessagePart, { type: "subagent" }>
  >();

  for (const ev of events) {
    switch (ev.type) {
      case "assistant/chunk":
        parts.push({
          type: ev.kind === "thinking" ? "thinking" : "text",
          text: ev.text,
          agent: ev.agent,
        });
        break;
      case "tool/call":
        parts.push({
          type: "tool_call",
          id: ev.id,
          name: ev.name,
          args: ev.args,
          agent: ev.agent,
        });
        break;
      case "tool/result":
        parts.push({
          type: "tool_result",
          id: ev.id,
          name: ev.name,
          result: ev.result,
          agent: ev.agent,
        });
        break;
      case "subagent/start":
        subagentMap.set(ev.id, {
          type: "subagent",
          id: ev.id,
          agent: ev.agent,
          label: ev.label,
          task: ev.task,
          status: "running",
        });
        parts.push(subagentMap.get(ev.id)!);
        break;
      case "subagent/end": {
        const sub: Extract<MessagePart, { type: "subagent" }> = {
          type: "subagent",
          id: ev.id,
          agent: ev.agent,
          label: ev.label,
          task: subagentMap.get(ev.id)?.task ?? "",
          status: ev.ok ? "done" : "error",
          summary: ev.summary,
          children: ev.children,
        };
        const idx = parts.findIndex(
          (p) => p.type === "subagent" && p.id === ev.id,
        );
        if (idx >= 0) parts[idx] = sub;
        else parts.push(sub);
        break;
      }
      case "compaction":
        parts.push({ type: "compaction", summary: ev.summary });
        break;
      default:
        break;
    }
  }
  return parts;
}

/** 从 tool_call 事件构建 LlmToolCall */
export function toLlmToolCall(ev: Extract<SessionEvent, { type: "tool/call" }>): LlmToolCall {
  return {
    id: ev.id,
    type: "function",
    function: {
      name: ev.name,
      arguments: JSON.stringify(ev.args ?? {}),
    },
  };
}
