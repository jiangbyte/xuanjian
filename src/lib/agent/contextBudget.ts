/**
 * @file 上下文容量估算、API usage 解析与窗口配置
 * @author Charlie
 */

import type { AgentToolDef } from "@/lib/agent/tools";
import type { MessagePart } from "@/lib/db";

/** 每条 message 的角色 / 结构开销（粗估） */
const MESSAGE_OVERHEAD = 4;

/** CJK 与 ASCII 分开估，比 length/4 更接近常见 tokenizer */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let score = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjk(code)) {
      score += 1.05;
    } else if (code <= 0x7f) {
      score += 0.28;
    } else {
      score += 0.55;
    }
  }
  return Math.max(1, Math.ceil(score));
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

/** 解析 context_tag：128k / 1M / 200000 / 64K 等 → token 上限 */
export function parseContextWindow(tag: string | null | undefined): number {
  if (!tag) return 128_000;
  const s = tag.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(k|m|万)?$/i);
  if (m) {
    const n = Number(m[1]);
    const u = (m[2] || "").toLowerCase();
    if (u === "m") return Math.round(n * 1_000_000);
    if (u === "k") return Math.round(n * 1000);
    if (u === "万") return Math.round(n * 10_000);
    if (n >= 1000) return Math.round(n);
    if (n <= 512) return Math.round(n * 1000);
    return Math.round(n);
  }
  const digits = s.match(/(\d+)/);
  if (digits) {
    const n = Number(digits[1]);
    if (s.includes("m")) return n * 1_000_000;
    if (s.includes("k")) return n * 1000;
    return n >= 1000 ? n : n * 1000;
  }
  return 128_000;
}

/** 模型返回的 token 用量（含 prompt cache） */
export type LlmUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** 本次请求 prompt 总 token（已按厂商语义合并，用于上下文条） */
  totalPrompt: number;
};

export function emptyUsage(): LlmUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalPrompt: 0 };
}

export function mergeUsage(a: LlmUsage | null, b: LlmUsage | null): LlmUsage {
  if (!a) return b ? { ...b } : emptyUsage();
  if (!b) return { ...a };
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: (a.cacheRead ?? 0) + (b.cacheRead ?? 0),
    cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
    totalPrompt: a.totalPrompt + b.totalPrompt,
  };
}

/** 从 OpenAI / Anthropic 原始响应解析 usage */
export function parseLlmUsage(
  raw: unknown,
  apiFormat: string,
): LlmUsage | null {
  if (!raw || typeof raw !== "object") return null;
  if (apiFormat === "anthropic") {
    const u = (
      raw as {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      }
    ).usage;
    if (!u) return null;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const input = u.input_tokens ?? 0;
    return {
      input,
      output: u.output_tokens ?? 0,
      cacheRead,
      cacheWrite,
      totalPrompt: input + cacheRead + cacheWrite,
    };
  }
  const u = (
    raw as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    }
  ).usage;
  if (!u) return null;
  const input = u.prompt_tokens ?? 0;
  return {
    input,
    output: u.completion_tokens ?? 0,
    cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: 0,
    totalPrompt: input,
  };
}

/** 有效 prompt token（用于上下文占用） */
export function promptTokensFromUsage(u: LlmUsage): number {
  return u.totalPrompt;
}

function partToEstimateText(part: MessagePart): string {
  switch (part.type) {
    case "text":
    case "thinking":
    case "status":
      return part.text;
    case "tool_call":
      return `tool_call ${part.name} ${JSON.stringify(part.args)}`;
    case "tool_result":
      return `tool_result ${part.name} ${part.result}`;
    case "tool_pending":
      return `tool_pending ${part.name}`;
    case "plan":
      return part.items.join("\n");
    case "subagent": {
      const kids = (part.children ?? []).map(partToEstimateText).join("\n");
      return [part.task, part.summary ?? "", kids].filter(Boolean).join("\n");
    }
    case "compaction":
      return part.summary;
    default:
      return "";
  }
}

/** UI 消息 → 与 runAgentTurn history 对齐的文本（仅 text 部分） */
export function historyTextFromUiMessages(
  messages: Array<{ role: "user" | "assistant"; parts: MessagePart[] }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: m.parts
        .filter((p): p is Extract<MessagePart, { type: "text" }> =>
          p.type === "text",
        )
        .map((p) => p.text)
        .join("\n"),
    }))
    .filter((m) => m.content.trim());
}

/** 当前轮 assistant 轨迹（tool/thinking 等，会进入 ReAct 上下文） */
export function inTurnPartsEstimate(
  messages: Array<{ role: string; parts: MessagePart[] }>,
): number {
  let total = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      if (p.type === "text") continue;
      const t = partToEstimateText(p);
      if (t) total += estimateTokens(t) + MESSAGE_OVERHEAD;
    }
  }
  return total;
}

function estimateLlmMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  let total = 0;
  for (const m of messages) {
    total += MESSAGE_OVERHEAD + estimateTokens(m.content);
  }
  return total;
}

export type ContextBudgetBreakdown = {
  system: number;
  tools: number;
  messages: number;
  inTurn: number;
  draft: number;
  total: number;
  limit: number;
  percent: number;
  /** 最近一次 API 上报的 prompt token（更准确） */
  lastApiPrompt?: number;
  lastApiOutput?: number;
  cacheRead?: number;
  cacheWrite?: number;
  sessionInput?: number;
  sessionOutput?: number;
};

export function estimateContextBudget(input: {
  systemPrompt?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  inTurnExtra?: number;
  tools?: AgentToolDef[];
  draft?: string;
  contextLimit: number;
  lastUsage?: LlmUsage | null;
  sessionUsage?: LlmUsage | null;
}): ContextBudgetBreakdown {
  const system = estimateTokens(input.systemPrompt ?? "");
  const tools = estimateTokens(
    input.tools ? JSON.stringify(input.tools) : "",
  );
  const messages = estimateLlmMessagesTokens(input.history ?? []);
  const inTurn = input.inTurnExtra ?? 0;
  const draft = estimateTokens(input.draft ?? "");
  const estimated = system + tools + messages + inTurn + draft;

  const lastApiPrompt = input.lastUsage
    ? promptTokensFromUsage(input.lastUsage)
    : undefined;
  const total = Math.max(estimated, lastApiPrompt ?? 0);

  const limit = Math.max(input.contextLimit, 1);
  const percent = Math.min(100, Math.round((total / limit) * 1000) / 10);

  return {
    system,
    tools,
    messages,
    inTurn,
    draft,
    total,
    limit,
    percent,
    lastApiPrompt,
    lastApiOutput: input.lastUsage?.output,
    cacheRead: input.lastUsage?.cacheRead,
    cacheWrite: input.lastUsage?.cacheWrite,
    sessionInput: input.sessionUsage
      ? promptTokensFromUsage(input.sessionUsage)
      : undefined,
    sessionOutput: input.sessionUsage?.output,
  };
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export type ThinkingMode = "off" | "high" | "max";

export const THINKING_MODE_KEY = "xuanjian.agent.thinkingMode";

export function loadThinkingMode(): ThinkingMode {
  try {
    const v = localStorage.getItem(THINKING_MODE_KEY);
    if (v === "off" || v === "high" || v === "max") return v;
  } catch {
    /* ignore */
  }
  return "high";
}

export function saveThinkingMode(mode: ThinkingMode) {
  try {
    localStorage.setItem(THINKING_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export const LAST_AGENT_SESSION_KEY = "xuanjian.agent.lastSessionId";

export function loadLastAgentSessionId(): number | null {
  try {
    const v = localStorage.getItem(LAST_AGENT_SESSION_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveLastAgentSessionId(id: number | null) {
  try {
    if (id == null) localStorage.removeItem(LAST_AGENT_SESSION_KEY);
    else localStorage.setItem(LAST_AGENT_SESSION_KEY, String(id));
  } catch {
    /* ignore */
  }
}
