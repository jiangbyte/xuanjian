/**
 * @file 全角色 prompt token 计量（压力检测复用）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";
import {
  buildContextMeterView,
  measureSurfaceTokens,
  projectedTokensFromSample,
} from "@/lib/agent/contextBudget/meter";
import {
  estimateTokens,
  promptTokensFromUsage,
  type ContextBudgetBreakdown,
  type LlmUsage,
} from "@/lib/agent/contextBudget";
import type { MessagePart } from "@/lib/db";

export type { ContextBudgetBreakdown, LlmUsage };

const MESSAGE_OVERHEAD = 4;

function messageContentText(m: LlmMessage): string {
  if (m.role === "tool") {
    return `${m.name ?? ""}:${String(m.content)}`;
  }
  if (m.role === "assistant") {
    const parts: string[] = [];
    if (m.content) parts.push(String(m.content));
    if (m.tool_calls?.length) {
      parts.push(JSON.stringify(m.tool_calls));
    }
    if (m.anthropic_content?.length) {
      parts.push(JSON.stringify(m.anthropic_content));
    }
    return parts.join("\n");
  }
  if (typeof m.content === "string") return m.content;
  return JSON.stringify(m.content ?? "");
}

export function measureLlmMessageTokens(m: LlmMessage): number {
  return MESSAGE_OVERHEAD + estimateTokens(messageContentText(m));
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

/** @deprecated 使用 projectedTokensFromSample */
export function projectedTokens(input: {
  estimated: number;
  lastUsage?: LlmUsage | null;
  sampledEstimated?: number;
}): number {
  return projectedTokensFromSample({
    surfaceTokens: input.estimated,
    pressureTokens: input.lastUsage
      ? promptTokensFromUsage(input.lastUsage)
      : null,
    sampledSurfaceTokens: input.sampledEstimated,
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
