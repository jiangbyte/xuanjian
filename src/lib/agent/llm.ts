/**
 * @file LLM 调用与多协议响应归一（OpenAI / Anthropic）
 * @author Charlie
 */

import { api } from "@/lib/tauri";
import type { AgentToolDef } from "@/lib/agent/tools";

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | AnthropicContentBlock[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: LlmToolCall[];
      /** Anthropic 原生 content blocks（含 tool_use） */
      anthropic_content?: AnthropicContentBlock[];
    }
  | { role: "tool"; tool_call_id: string; content: string; name?: string };

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string; text?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export type NormalizedLlmReply = {
  thinking: string;
  text: string;
  toolCalls: LlmToolCall[];
  /** Anthropic 下一轮 assistant 消息需要完整 content blocks */
  anthropicContent?: AnthropicContentBlock[];
  raw: unknown;
};

type ProviderCfg = {
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  model: string;
  thinkingMode?: "off" | "high" | "max";
  maxTokens?: number;
};

/** 将 OpenAI tools 转为 Anthropic tools。 */
export function toAnthropicTools(tools: AgentToolDef[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

/** 前端统一用 OpenAI 风格 messages；发 Anthropic 前在 Rust 侧再转换。 */
export async function chatCompletion(
  cfg: ProviderCfg,
  messages: LlmMessage[],
  tools: AgentToolDef[],
): Promise<NormalizedLlmReply> {
  const raw = await api.aiChatCompletion({
    baseUrl: cfg.baseUrl,
    apiFormat: cfg.apiFormat,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages,
    tools:
      cfg.apiFormat === "anthropic" ? toAnthropicTools(tools) : tools,
    stream: false,
    thinkingMode: cfg.thinkingMode ?? "high",
    maxTokens: cfg.maxTokens,
  });
  return normalizeReply(cfg.apiFormat, raw, {
    stripThinking: (cfg.thinkingMode ?? "high") === "off",
  });
}

export function normalizeReply(
  apiFormat: string,
  raw: unknown,
  opts?: { stripThinking?: boolean },
): NormalizedLlmReply {
  const reply =
    apiFormat === "anthropic"
      ? normalizeAnthropic(raw)
      : normalizeOpenAi(raw);
  if (opts?.stripThinking) {
    return { ...reply, thinking: "" };
  }
  return reply;
}

function normalizeOpenAi(raw: unknown): NormalizedLlmReply {
  const r = raw as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | null;
        tool_calls?: Array<{
          id: string;
          type?: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const msg = r.choices?.[0]?.message;
  let text = msg?.content ?? "";
  let thinking =
    msg?.reasoning_content ?? msg?.reasoning ?? "";

  // 部分模型把思考塞进 <think>…</think>
  const extracted = splitThinkTags(text);
  if (extracted.thinking) {
    thinking = thinking
      ? `${thinking}\n${extracted.thinking}`
      : extracted.thinking;
    text = extracted.text;
  }

  const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    type: "function",
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments || "{}",
    },
  }));

  return { thinking, text, toolCalls, raw };
}

function normalizeAnthropic(raw: unknown): NormalizedLlmReply {
  const r = raw as {
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
  };
  const blocks = r.content ?? [];
  let text = "";
  let thinking = "";
  const toolCalls: LlmToolCall[] = [];
  const anthropicContent: AnthropicContentBlock[] = [];

  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      text += b.text;
      anthropicContent.push({ type: "text", text: b.text });
    } else if (b.type === "thinking") {
      const t = b.thinking ?? b.text ?? "";
      thinking += t;
      anthropicContent.push({ type: "thinking", thinking: t });
    } else if (b.type === "tool_use" && b.id && b.name) {
      toolCalls.push({
        id: b.id,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input ?? {}),
        },
      });
      anthropicContent.push({
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: b.input ?? {},
      });
    }
  }

  const extracted = splitThinkTags(text);
  if (extracted.thinking) {
    thinking = thinking
      ? `${thinking}\n${extracted.thinking}`
      : extracted.thinking;
    text = extracted.text;
  }

  return { thinking, text, toolCalls, anthropicContent, raw };
}

function splitThinkTags(text: string): { thinking: string; text: string } {
  const re = /<think>([\s\S]*?)<\/think>/gi;
  const parts: string[] = [];
  let cleaned = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    parts.push(m[1].trim());
  }
  if (parts.length) {
    cleaned = text.replace(re, "").trim();
  }
  return { thinking: parts.join("\n"), text: cleaned };
}
