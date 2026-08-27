/**
 * @file 上下文占用投影（对齐 dsh token-meter contextPressure + contextBreakdown）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";
import {
  estimateSystemTokens,
  estimateToolsTokens,
  parseContextWindow,
  promptTokensFromUsage,
  type LlmUsage,
} from "@/lib/agent/contextBudget";
import { measureLlmMessageTokens } from "@/lib/agent/contextBudget/projected";
import {
  buildHistoryFromMessageRows,
  deriveMessages,
  messageRowToEvents,
} from "@/lib/agent/session";
import type { MessagePart } from "@/lib/db";

/** 下一次请求的完整 prompt 表层 token（system + tools + messages） */
export function measureSurfaceTokens(input: {
  system: string;
  tools: AgentToolDef[];
  messages: LlmMessage[];
}): number {
  const system = estimateSystemTokens(input.system);
  const tools = estimateToolsTokens(input.tools);
  const messages = input.messages.reduce(
    (n, m) => n + measureLlmMessageTokens(m),
    0,
  );
  return system + tools + messages;
}

/**
 * projectedTokens = pressureTokens + (surfaceNow - surfaceAtLastSample)
 * 无 API 样本时退化为完整表层估算。
 */
export function projectedTokensFromSample(input: {
  surfaceTokens: number;
  pressureTokens?: number | null;
  sampledSurfaceTokens?: number | null;
}): number {
  const { surfaceTokens, pressureTokens, sampledSurfaceTokens } = input;
  if (pressureTokens == null) return surfaceTokens;
  const sampled = sampledSurfaceTokens ?? surfaceTokens;
  return Math.max(0, pressureTokens + surfaceTokens - sampled);
}

export type ContextMeterView = {
  /** 占用率分子：下一次请求预估 prompt（优先 projected） */
  projectedTokens: number;
  /** 上次 API 上报的 prompt（不含 output） */
  pressureTokens?: number;
  /** 当前完整表层启发式估算 */
  surfaceTokens: number;
  /** 上次 usage 采样时的表层 token */
  sampledSurfaceTokens?: number;
  contextWindow: number;
  percent: number;
  threshold: number;
  thresholdPercent: number;
  overThreshold: boolean;
  /** 组成拆分（启发式，不求和等于 projected） */
  systemTokens: number;
  toolsTokens: number;
  messageTokens: number;
  lastApiPrompt?: number;
  lastApiOutput?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export function buildContextMeterView(input: {
  system: string;
  tools: AgentToolDef[];
  messages: LlmMessage[];
  contextTag?: string;
  lastUsage?: LlmUsage | null;
  sampledSurfaceTokens?: number | null;
  thresholdRatio?: number;
}): ContextMeterView {
  const contextWindow = parseContextWindow(input.contextTag ?? "128k");
  const systemTokens = estimateSystemTokens(input.system);
  const toolsTokens = estimateToolsTokens(input.tools);
  const messageTokens = input.messages.reduce(
    (n, m) => n + measureLlmMessageTokens(m),
    0,
  );
  const surfaceTokens = systemTokens + toolsTokens + messageTokens;

  const pressureTokens = input.lastUsage
    ? promptTokensFromUsage(input.lastUsage)
    : undefined;
  const sampledSurfaceTokens =
    pressureTokens != null
      ? (input.sampledSurfaceTokens ?? surfaceTokens)
      : undefined;

  const projectedTokens = projectedTokensFromSample({
    surfaceTokens,
    pressureTokens,
    sampledSurfaceTokens,
  });

  const ratio = input.thresholdRatio ?? 0.8;
  const threshold = contextWindow * ratio;

  return {
    projectedTokens,
    pressureTokens,
    surfaceTokens,
    sampledSurfaceTokens,
    contextWindow,
    percent: Math.min(
      100,
      Math.round((projectedTokens / contextWindow) * 1000) / 10,
    ),
    threshold,
    thresholdPercent: Math.round((threshold / contextWindow) * 1000) / 10,
    overThreshold: projectedTokens > threshold,
    systemTokens,
    toolsTokens,
    messageTokens,
    lastApiPrompt: pressureTokens,
    lastApiOutput: input.lastUsage?.output,
    cacheRead: input.lastUsage?.cacheRead,
    cacheWrite: input.lastUsage?.cacheWrite,
  };
}

/** 本轮 assistant parts → LLM 消息（与 deriveMessages 一致） */
export function inTurnPartsToLlmMessages(parts: MessagePart[]): LlmMessage[] {
  if (!parts.length) return [];
  return deriveMessages(messageRowToEvents("assistant", parts));
}

/** 从 UI 消息构建下一次请求的 messages 部分（含进行中轮次 + 草稿） */
export function buildProjectedMessagesFromUi(input: {
  messages: Array<{ role: "user" | "assistant"; parts: MessagePart[] }>;
  busy: boolean;
  draft?: string;
}): LlmMessage[] {
  const stable = input.busy ? input.messages.slice(0, -1) : input.messages;
  const rows = stable.map((m, i) => ({
    id: i,
    session_id: 0,
    role: m.role,
    parts_json: JSON.stringify(m.parts),
    created_at: "",
  }));
  const history = buildHistoryFromMessageRows(rows);

  if (input.busy) {
    const cur = input.messages[input.messages.length - 1];
    if (cur?.role === "assistant" && cur.parts.length) {
      history.push(...inTurnPartsToLlmMessages(cur.parts));
    }
  }

  const draft = input.draft?.trim();
  if (draft) {
    history.push({ role: "user", content: draft });
  }

  return history;
}
