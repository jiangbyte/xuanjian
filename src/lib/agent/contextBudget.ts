/**
 * @file 上下文容量估算与窗口解析
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";

/** 粗估：UTF-16 码元 / 4 ≈ tokens（中文略偏保守） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
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
    // 裸数字如 128 常表示 128k
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

export type ContextBudgetBreakdown = {
  system: number;
  tools: number;
  messages: number;
  draft: number;
  total: number;
  limit: number;
  percent: number;
};

export function estimateContextBudget(input: {
  systemPrompt?: string;
  messages: LlmMessage[];
  tools?: AgentToolDef[];
  draft?: string;
  contextLimit: number;
}): ContextBudgetBreakdown {
  const system = estimateTokens(input.systemPrompt ?? "");
  const tools = estimateTokens(
    input.tools ? JSON.stringify(input.tools) : "",
  );
  let messages = 0;
  for (const m of input.messages) {
    if (typeof m.content === "string") {
      messages += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      messages += estimateTokens(JSON.stringify(m.content));
    }
    if ("tool_calls" in m && m.tool_calls) {
      messages += estimateTokens(JSON.stringify(m.tool_calls));
    }
  }
  const draft = estimateTokens(input.draft ?? "");
  const total = system + tools + messages + draft;
  const limit = Math.max(input.contextLimit, 1);
  const percent = Math.min(100, Math.round((total / limit) * 1000) / 10);
  return { system, tools, messages, draft, total, limit, percent };
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

/** 最近一次打开的 Agent 会话（折叠右栏 / 重挂载后恢复） */
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
