/**
 * @file 压缩 pre-step hook 与溢出恢复
 * @author Charlie
 */

import { useHook } from "@/lib/agent/hooks";
import { checkContextPressure } from "@/lib/agent/compaction/pressure";
import { compactIfNeeded } from "@/lib/agent/compaction/summarize";
import type { ProviderBundle } from "@/lib/agent/runtime/provider";
import type { LlmUsage } from "@/lib/agent/contextBudget";
import type { MessagePart } from "@/lib/db";
import type { LlmMessage } from "@/lib/agent/llm";

type StatusFn = (text: string) => void;

let compactionProvider: ProviderBundle | null = null;
let compactionSystem = "";
let compactionTools: import("@/lib/agent/tools").AgentToolDef[] = [];
let compactionSignal: AbortSignal | undefined;
let compactionLastUsage: LlmUsage | null = null;
let compactionSampledSurface: number | null = null;
let compactionInTurnParts: MessagePart[] = [];
let compactionOnStatus: StatusFn | null = null;

export function setCompactionRuntime(opts: {
  provider: ProviderBundle;
  system: string;
  tools: import("@/lib/agent/tools").AgentToolDef[];
  signal?: AbortSignal;
  lastUsage?: LlmUsage | null;
  sampledSurfaceTokens?: number | null;
  inTurnParts?: MessagePart[];
  onStatus?: StatusFn;
}): void {
  compactionProvider = opts.provider;
  compactionSystem = opts.system;
  compactionTools = opts.tools;
  compactionSignal = opts.signal;
  compactionLastUsage = opts.lastUsage ?? null;
  compactionSampledSurface = opts.sampledSurfaceTokens ?? null;
  compactionInTurnParts = opts.inTurnParts ?? [];
  compactionOnStatus = opts.onStatus ?? null;
}

let compactionHookRegistered = false;

export function registerCompactionHook(): void {
  if (compactionHookRegistered) return;
  compactionHookRegistered = true;

  useHook("agent/pre-step", async (ctx, next) => {
    const base = await next();
    if (base.kind !== "continue") return base;
    if (!compactionProvider) return base;

    const pressure = await checkContextPressure({
      system: compactionSystem,
      tools: compactionTools,
      messages: ctx.messages,
      inTurnParts: compactionInTurnParts,
      modelContextTag: compactionProvider.contextTag,
      lastUsage: compactionLastUsage,
      sampledSurfaceTokens: compactionSampledSurface,
    });

    if (!pressure.overThreshold) return base;

    try {
      compactionOnStatus?.("上下文接近上限，正在压缩历史…");
      const result = await compactIfNeeded({
        provider: compactionProvider,
        system: compactionSystem,
        tools: compactionTools,
        messages: ctx.messages,
        signal: compactionSignal,
      });
      if (!result?.summary) return base;
      return {
        kind: "inject",
        messages: result.messages,
      };
    } catch (e) {
      compactionOnStatus?.(`压缩失败：${String(e)}`);
      return base;
    }
  });
}

/** 溢出时强制压缩（driver 调用） */
export async function compactOnOverflow(
  messages: LlmMessage[],
): Promise<LlmMessage[] | null> {
  if (!compactionProvider) return null;
  try {
    compactionOnStatus?.("上下文溢出，正在强制压缩…");
    const result = await compactIfNeeded({
      provider: compactionProvider,
      system: compactionSystem,
      tools: compactionTools,
      messages,
      signal: compactionSignal,
      force: true,
      retainRatio: 0,
    });
    return result?.messages ?? null;
  } catch (e) {
    compactionOnStatus?.(`强制压缩失败：${String(e)}`);
    return null;
  }
}

export function resetCompactionHook(): void {
  compactionHookRegistered = false;
  compactionProvider = null;
  compactionLastUsage = null;
  compactionInTurnParts = [];
}
