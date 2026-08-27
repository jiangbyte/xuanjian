/**
 * @file 单轮内 tool 消息 token 感知截断
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import {
  estimateTokens,
  parseContextWindow,
  promptTokensFromUsage,
  type LlmUsage,
} from "@/lib/agent/contextBudget";
import { measurePromptTokens } from "@/lib/agent/contextBudget/projected";
import type { AgentToolDef } from "@/lib/agent/tools";

export type TruncateOpts = {
  contextLimit?: number;
  lastUsage?: LlmUsage | null;
  system?: string;
  tools?: AgentToolDef[];
  /** 剩余预算低于此比例时加大裁剪力度 */
  pressureRatio?: number;
};

const HEAD_CHARS = 1500;
const TAIL_CHARS = 1500;

function pruneContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars < HEAD_CHARS + TAIL_CHARS + 40) {
    return `${content.slice(0, maxChars)}\n…(已截断)`;
  }
  return `${content.slice(0, HEAD_CHARS)}\n…(已截断，共 ${content.length} 字符)…\n${content.slice(-TAIL_CHARS)}`;
}

function resolveToolKeepFull(opts?: TruncateOpts): number {
  const limit = opts?.contextLimit ?? 128_000;
  const estimated = measurePromptTokens({
    system: opts?.system,
    tools: opts?.tools,
    messages: [],
  });
  const used =
    opts?.lastUsage != null
      ? promptTokensFromUsage(opts.lastUsage)
      : estimated;
  const ratio = used / limit;
  if (ratio > 0.85) return 3;
  if (ratio > 0.7) return 5;
  if (ratio > 0.55) return 6;
  return 8;
}

/** 按 token 压力裁剪历史 tool Observation */
export function compactLlmMessagesForModel(
  messages: LlmMessage[],
  opts?: TruncateOpts,
): LlmMessage[] {
  const limit = opts?.contextLimit ?? parseContextWindow("128k");
  const totalEst = measurePromptTokens({
    system: opts?.system,
    tools: opts?.tools,
    messages,
  });
  const budgetLeft = Math.max(
    0,
    limit * 0.92 -
      (opts?.lastUsage ? promptTokensFromUsage(opts.lastUsage) : totalEst * 0.5),
  );

  const TOOL_KEEP_FULL = resolveToolKeepFull({ ...opts, contextLimit: limit });
  const oldToolMaxTokens = Math.max(
    400,
    Math.min(3500, Math.floor(budgetLeft / Math.max(1, TOOL_KEEP_FULL + 2))),
  );
  const recentToolMaxTokens = Math.max(oldToolMaxTokens, 8000);

  const toolIdxs: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool") toolIdxs.push(i);
  });
  const keepFullFrom = Math.max(0, toolIdxs.length - TOOL_KEEP_FULL);

  return messages.map((m, i) => {
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    const pos = toolIdxs.indexOf(i);
    const maxTokens =
      pos >= keepFullFrom ? recentToolMaxTokens : oldToolMaxTokens;
    const est = estimateTokens(m.content);
    if (est <= maxTokens) return m;
    const maxChars = Math.max(500, maxTokens * 3);
    return {
      ...m,
      content: pruneContent(m.content, maxChars),
    };
  });
}
