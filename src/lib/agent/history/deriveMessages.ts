/**
 * @file 从 SessionEvent 投影 LLM 消息历史
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import { messageRowToEvents, toLlmToolCall } from "./partsMapping";
import type { DeriveMessagesOptions, SessionEvent } from "./types";
import type { MessagePart } from "@/lib/db";

type PendingAssistant = {
  text: string;
  thinking: string;
  toolCalls: import("@/lib/agent/llm").LlmToolCall[];
  anthropicContent?: import("@/lib/agent/llm").AnthropicContentBlock[];
  agent?: string;
};

function ensureAnthropicToolUses(
  blocks: import("@/lib/agent/llm").AnthropicContentBlock[],
  toolCalls: import("@/lib/agent/llm").LlmToolCall[],
): import("@/lib/agent/llm").AnthropicContentBlock[] {
  const existing = new Set(
    blocks.filter((b) => b.type === "tool_use").map((b) => b.id),
  );
  const out = [...blocks];
  for (const tc of toolCalls) {
    if (existing.has(tc.id)) continue;
    let input: unknown = {};
    try {
      input = JSON.parse(tc.function.arguments || "{}");
    } catch {
      input = {};
    }
    out.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input,
    });
    existing.add(tc.id);
  }
  return out;
}

function flushAssistant(
  messages: LlmMessage[],
  pending: PendingAssistant | null,
): PendingAssistant | null {
  if (!pending) return null;
  const hasTools = pending.toolCalls.length > 0;
  const content = pending.text.trim() || null;
  if (hasTools) {
    let anthropicContent = pending.anthropicContent ?? [];
    if (
      pending.thinking.trim() &&
      !anthropicContent.some((b) => b.type === "thinking")
    ) {
      anthropicContent = [
        { type: "thinking", thinking: pending.thinking.trim() },
        ...anthropicContent,
      ];
    }
    // 历史回放常只有 thinking；必须补齐 tool_use，否则 Rust 优先 anthropic_content
    // 会丢掉 OpenAI tool_calls，导致后续 tool_result 孤儿。
    anthropicContent = ensureAnthropicToolUses(
      anthropicContent,
      pending.toolCalls,
    );
    messages.push({
      role: "assistant",
      content,
      tool_calls: pending.toolCalls,
      anthropic_content: anthropicContent.length ? anthropicContent : undefined,
    });
  } else if (content || pending.thinking) {
    const text =
      pending.thinking && content && pending.thinking !== content
        ? `${pending.thinking}\n${content}`
        : content || pending.thinking;
    messages.push({ role: "assistant", content: text });
  }
  return null;
}

/**
 * 将会话事件流投影为 LLM 消息（不含 system）。
 * 规则：模型可见 ⟺ 已记录的事件。
 */
export function deriveMessages(
  events: SessionEvent[],
  opts: DeriveMessagesOptions = {},
): LlmMessage[] {
  const subagentAsSummary = opts.subagentAsSummary !== false;
  const messages: LlmMessage[] = [];
  let pending: PendingAssistant | null = null;
  let pendingToolCalls: Array<Extract<SessionEvent, { type: "tool/call" }>> =
    [];

  const flushToolBatch = () => {
    if (!pendingToolCalls.length) return;
    pending = pending ?? { text: "", thinking: "", toolCalls: [] };
    for (const tc of pendingToolCalls) {
      pending.toolCalls.push(toLlmToolCall(tc));
    }
    pendingToolCalls = [];
  };

  for (const ev of events) {
    switch (ev.type) {
      case "user/message":
        pending = flushAssistant(messages, pending);
        messages.push({ role: "user", content: ev.content });
        break;

      case "compaction":
        pending = flushAssistant(messages, pending);
        messages.push({
          role: "user",
          content: `<compacted-summary>\n${ev.summary}\n</compacted-summary>`,
        });
        break;

      case "assistant/chunk":
        pending = pending ?? { text: "", thinking: "", toolCalls: [] };
        if (ev.kind === "thinking") pending.thinking += ev.text;
        else pending.text += ev.text;
        break;

      case "assistant/message": {
        pending = pending ?? { text: "", thinking: "", toolCalls: [] };
        if (ev.thinking) pending.thinking += ev.thinking;
        if (ev.text) pending.text += ev.text;
        if (ev.toolCalls?.length) {
          pending.toolCalls.push(...ev.toolCalls);
        }
        if (ev.anthropicContent) {
          pending.anthropicContent = ev.anthropicContent;
        }
        pending = flushAssistant(messages, pending);
        break;
      }

      case "tool/call":
        pendingToolCalls.push(ev);
        break;

      case "tool/result":
        flushToolBatch();
        pending = flushAssistant(messages, pending);
        messages.push({
          role: "tool",
          tool_call_id: ev.id,
          name: ev.name,
          content: ev.result,
        });
        break;

      case "subagent/end": {
        flushToolBatch();
        pending = flushAssistant(messages, pending);
        if (subagentAsSummary) {
          messages.push({
            role: "tool",
            tool_call_id: ev.id,
            name: "run_subagent",
            content: JSON.stringify({
              ok: ev.ok,
              agent: ev.agent,
              label: ev.label,
              summary: ev.summary.slice(0, 8000),
            }),
          });
        } else if (ev.children?.length) {
          const childEvents = ev.children.flatMap((p: MessagePart) =>
            messageRowToEvents("assistant", [p]),
          );
          messages.push(...deriveMessages(childEvents, opts));
        }
        break;
      }

      default:
        break;
    }
  }

  flushToolBatch();
  flushAssistant(messages, pending);
  return messages;
}
