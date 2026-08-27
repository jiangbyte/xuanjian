/**
 * @file 全角色 prompt token 计量（压力检测复用）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";
import {
  buildContextMeterView,
  measureSurfaceTokens,
} from "@/lib/agent/contextBudget/meter";
import {
  BLOCK_OVERHEAD,
  ROLE_OVERHEAD,
  estimateTokens,
  type ContextBudgetBreakdown,
  type LlmUsage,
} from "@/lib/agent/contextBudget";
import type { MessagePart } from "@/lib/db";

export type { ContextBudgetBreakdown, LlmUsage };

/** 对齐 dsh estimateMessage：ROLE_OVERHEAD + 各 content block 密度 */
export function measureLlmMessageTokens(m: LlmMessage): number {
  let tokens = ROLE_OVERHEAD;

  if (m.role === "tool") {
    const text = `${m.name ?? ""}:${String(m.content ?? "")}`;
    if (text.length > 1) tokens += estimateTokens(text) + BLOCK_OVERHEAD;
    return tokens;
  }

  if (m.role === "assistant") {
    if (m.content) {
      tokens += estimateTokens(String(m.content)) + BLOCK_OVERHEAD;
    }
    for (const tc of m.tool_calls ?? []) {
      tokens +=
        estimateTokens(tc.function?.name ?? "") +
        estimateTokens(tc.function?.arguments ?? "") +
        BLOCK_OVERHEAD;
    }
    if (m.anthropic_content?.length) {
      tokens +=
        estimateTokens(JSON.stringify(m.anthropic_content)) + BLOCK_OVERHEAD;
    }
    return tokens;
  }

  const content =
    typeof m.content === "string"
      ? m.content
      : m.content == null
        ? ""
        : JSON.stringify(m.content);
  if (content) tokens += estimateTokens(content) + BLOCK_OVERHEAD;
  return tokens;
}

export function measurePromptTokens(input: {
  system?: string;
  tools?: AgentToolDef[];
  messages: LlmMessage[];
  draft?: string;
  inTurnParts?: MessagePart[];
}): number {
  return measureSurfaceTokens({
    system: input.system ?? "",
    tools: input.tools ?? [],
    messages: input.messages,
  });
}

export function buildContextPressure(input: {
  system: string;
  tools: AgentToolDef[];
  messages: LlmMessage[];
  draft?: string;
  inTurnParts?: MessagePart[];
  contextTag?: string;
  lastUsage?: LlmUsage | null;
  sampledSurfaceTokens?: number | null;
  thresholdRatio?: number;
}): ContextBudgetBreakdown & {
  projected: number;
  threshold: number;
  overThreshold: boolean;
} {
  const view = buildContextMeterView({
    system: input.system,
    tools: input.tools,
    messages: input.messages,
    contextTag: input.contextTag,
    lastUsage: input.lastUsage,
    sampledSurfaceTokens: input.sampledSurfaceTokens,
    thresholdRatio: input.thresholdRatio,
  });

  return {
    system: view.systemTokens,
    tools: view.toolsTokens,
    messages: view.messageTokens,
    inTurn: 0,
    draft: 0,
    total: view.projectedTokens,
    limit: view.contextWindow,
    percent: view.percent,
    lastApiPrompt: view.lastApiPrompt,
    projected: view.projectedTokens,
    threshold: view.threshold,
    overThreshold: view.overThreshold,
  };
}
