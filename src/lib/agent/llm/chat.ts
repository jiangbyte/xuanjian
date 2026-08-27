/**
 * @file LLM 调用与多协议响应归一（OpenAI / Anthropic）
 * @author Charlie
 */

import { api } from "@/lib/tauri";
import { parseLlmUsage, type LlmUsage } from "@/lib/agent/contextBudget";
import { REACT_LIMITS } from "@xuanjian/agent-core";
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
  usage?: LlmUsage | null;
  raw: unknown;
};

type ProviderCfg = {
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  model: string;
  thinkingMode?: "off" | "high" | "max";
  maxTokens?: number;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
  signal?: AbortSignal;
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
  const timeoutMs = cfg.timeoutMs ?? REACT_LIMITS.LLM_TIMEOUT_MS;
  const parentSignal = cfg.signal;

  if (parentSignal?.aborted) {
    throw new Error("已取消");
  }

  const invokePromise = api.aiChatCompletion({
    baseUrl: cfg.baseUrl,
    apiFormat: cfg.apiFormat,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages,
    tools: cfg.apiFormat === "anthropic" ? toAnthropicTools(tools) : tools,
    stream: false,
    thinkingMode: cfg.thinkingMode ?? "high",
    maxTokens: cfg.maxTokens,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`模型调用超时（${Math.round(timeoutMs / 60_000)} 分钟）`),
        ),
      timeoutMs,
    );
  });

  const abortPromise =
    parentSignal &&
    new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error("已取消"));
      if (parentSignal.aborted) onAbort();
      else parentSignal.addEventListener("abort", onAbort, { once: true });
    });

  const racers: Promise<unknown>[] = [invokePromise, timeoutPromise];
  if (abortPromise) racers.push(abortPromise);

  let raw: unknown;
  try {
    raw = await Promise.race(racers);
  } finally {
    if (timer) clearTimeout(timer);
  }

  return normalizeReply(cfg.apiFormat, raw, {
    stripThinking: (cfg.thinkingMode ?? "high") === "off",
    apiFormat: cfg.apiFormat,
  });
}

export function normalizeReply(
  apiFormat: string,
  raw: unknown,
  opts?: { stripThinking?: boolean; apiFormat?: string },
): NormalizedLlmReply {
  const fmt = opts?.apiFormat ?? apiFormat;
  const reply =
    fmt === "anthropic" ? normalizeAnthropic(raw) : normalizeOpenAi(raw);
  const usage = parseLlmUsage(raw, fmt);
  const merged = { ...reply, usage, raw };
  if (opts?.stripThinking) {
    return { ...merged, thinking: "" };
  }
  return merged;
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
  let thinking = msg?.reasoning_content ?? msg?.reasoning ?? "";

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
  const patterns = [
    /<think>([\s\S]*?)<\/redacted_thinking>/gi,
    /([\s\S]*?)<\/think>/gi,
    /<thinking>([\s\S]*?)<\/thinking>/gi,
  ];
  const parts: string[] = [];
  let cleaned = text;
  for (const re of patterns) {
    for (const m of cleaned.matchAll(re)) {
      parts.push(m[1].trim());
    }
    cleaned = cleaned.replace(re, "").trim();
  }
  return { thinking: parts.join("\n"), text: cleaned || text };
}
