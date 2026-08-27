/**
 * @file 事件溯源会话类型（对齐 harness turn/step 词汇表）
 * @author Charlie
 */

import type { LlmToolCall, AnthropicContentBlock } from "@/lib/agent/llm";
import type { MessagePart } from "@/lib/db";

export type SessionEvent =
  | { type: "turn/start"; turn: number; seq: number }
  | { type: "turn/end"; turn: number; reason?: string; seq: number }
  | { type: "step/start"; turn: number; step: number; seq: number }
  | { type: "step/end"; turn: number; step: number; seq: number }
  | { type: "user/message"; content: string; seq: number }
  | {
      type: "assistant/chunk";
      kind: "thinking" | "text";
      text: string;
      agent?: string;
      seq: number;
    }
  | {
      type: "assistant/message";
      text?: string;
      thinking?: string;
      toolCalls?: LlmToolCall[];
      anthropicContent?: AnthropicContentBlock[];
      agent?: string;
      seq: number;
    }
  | {
      type: "tool/call";
      id: string;
      name: string;
      args: unknown;
      agent?: string;
      seq: number;
    }
  | {
      type: "tool/result";
      id: string;
      name: string;
      result: string;
      agent?: string;
      seq: number;
    }
  | {
      type: "subagent/start";
      id: string;
      agent: string;
      label: string;
      task: string;
      seq: number;
    }
  | {
      type: "subagent/end";
      id: string;
      agent: string;
      label: string;
      ok: boolean;
      summary: string;
      children?: MessagePart[];
      seq: number;
    }
  | { type: "compaction"; summary: string; seq: number };

export type DeriveMessagesOptions = {
  /** SubAgent 子轨迹投影为摘要而非完整 tool 链 */
  subagentAsSummary?: boolean;
};
