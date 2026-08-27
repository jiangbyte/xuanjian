/**
 * @file 上下文压力检测
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";
import {
  buildContextPressure,
  type ContextBudgetBreakdown,
} from "@/lib/agent/contextBudget/projected";
import type { LlmUsage } from "@/lib/agent/contextBudget";
import type { MessagePart } from "@/lib/db";
import { getSetting } from "@/lib/db";

export type PressureResult = {
  overThreshold: boolean;
  breakdown: ContextBudgetBreakdown & {
    projected: number;
    threshold: number;
  };
  thresholdRatio: number;
};

export async function checkContextPressure(input: {
  system: string;
  tools: AgentToolDef[];
  messages: LlmMessage[];
  inTurnParts?: MessagePart[];
  modelContextTag?: string;
  lastUsage?: LlmUsage | null;
  sampledSurfaceTokens?: number | null;
}): Promise<PressureResult> {
  const autoCompact = (await getSetting("agent.auto_compact")) !== "false";
  const thresholdRatio = autoCompact
    ? Number((await getSetting("agent.compact_threshold")) ?? "0.8") || 0.8
    : 1.1;

  const breakdown = buildContextPressure({
    system: input.system,
    tools: input.tools,
    messages: input.messages,
    contextTag: input.modelContextTag,
    lastUsage: input.lastUsage,
    sampledSurfaceTokens: input.sampledSurfaceTokens,
    thresholdRatio,
  });

  return {
    overThreshold: breakdown.overThreshold,
    breakdown,
    thresholdRatio,
  };
}

export function isContextOverflowError(e: unknown): boolean {
  const msg = String(e).toLowerCase();
  return (
    msg.includes("context") ||
    msg.includes("token") ||
    msg.includes("length") ||
    msg.includes("too long") ||
    msg.includes("maximum") ||
    msg.includes("413") ||
    msg.includes("400")
  );
}
