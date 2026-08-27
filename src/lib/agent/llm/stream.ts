/**
 * @file 流式与非流式 LLM 调用统一入口
 * @author Charlie
 */

import { api, onAiChatChunk, type AiChatChunk } from "@/lib/tauri";
import {
  chatCompletion,
  type LlmMessage,
  type LlmToolCall,
  toAnthropicTools,
} from "@/lib/agent/llm";
import { parseLlmUsage, type LlmUsage } from "@/lib/agent/contextBudget";
import { BlockAssembler } from "@/lib/agent/llm/assembler";
import { mergeStreamToolCallDeltas } from "@/lib/agent/llm/stream-tool-calls";
import { REACT_LIMITS } from "@xuanjian/agent-core";
import type { AgentToolDef } from "@/lib/agent/tools";
import type { ProviderBundle } from "@/lib/agent/runtime/provider";
import type { AgentActivityPhase, RuntimeEvent } from "@xuanjian/agent-core";

export type StreamCallbacks = {
  onThinkingDelta?: (text: string) => void;
  onTextDelta?: (text: string) => void;
  onUsage?: (usage: LlmUsage) => void;
};

type ProviderCfg = {
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  model: string;
  thinkingMode?: "off" | "high" | "max";
  maxTokens?: number;
  signal?: AbortSignal;
};

function toProviderCfg(
  provider: ProviderBundle,
  thinkingMode: "off" | "high" | "max",
  signal?: AbortSignal,
): ProviderCfg {
  return {
    baseUrl: provider.provider.base_url,
    apiFormat: provider.provider.api_format,
    apiKey: provider.apiKey,
    model: provider.modelId,
    thinkingMode,
    maxTokens: provider.maxTokens,
    signal,
  };
}

/** 优先流式；Anthropic 在 Rust 侧支持 SSE 后同样走流式 */
export async function requestModelReply(
  provider: ProviderBundle,
  messages: LlmMessage[],
  tools: AgentToolDef[],
  opts: {
    thinkingMode: "off" | "high" | "max";
    signal?: AbortSignal;
    stream?: boolean;
    callbacks?: StreamCallbacks;
  },
) {
  const cfg = toProviderCfg(provider, opts.thinkingMode, opts.signal);
  const useStream = opts.stream !== false;

  if (!useStream) {
    return chatCompletion(cfg, messages, tools);
  }

  const jobId = await api.aiChatStream({
    baseUrl: cfg.baseUrl,
    apiFormat: cfg.apiFormat,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages,
    tools: cfg.apiFormat === "anthropic" ? toAnthropicTools(tools) : tools,
    stream: true,
    thinkingMode: cfg.thinkingMode ?? "high",
    maxTokens: cfg.maxTokens,
  });

  const assembler = new BlockAssembler();
  const toolAcc = new Map<number, LlmToolCall>();

  return new Promise<import("@/lib/agent/llm").NormalizedLlmReply>(
    (resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        unlisten?.();
        if (err) reject(err);
        else {
          resolve(
            assembler.finalize(cfg.apiFormat, cfg.thinkingMode === "off"),
          );
        }
      };

      const timeout = setTimeout(() => {
        void api.aiChatCancel(jobId);
        finish(
          new Error(
            `模型调用超时（${Math.round(REACT_LIMITS.LLM_TIMEOUT_MS / 60_000)} 分钟）`,
          ),
        );
      }, REACT_LIMITS.LLM_TIMEOUT_MS);

      const onAbort = () => {
        void api.aiChatCancel(jobId);
        finish(new Error("已取消"));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      let unlisten: (() => void) | undefined;

      void onAiChatChunk((chunk: AiChatChunk) => {
        if (chunk.jobId !== jobId) return;
        if (chunk.error) {
          clearTimeout(timeout);
          finish(new Error(chunk.error));
          return;
        }
        if (chunk.thinking) {
          assembler.pushThinking(chunk.thinking);
          opts.callbacks?.onThinkingDelta?.(chunk.thinking);
        }
        if (chunk.delta) {
          assembler.pushText(chunk.delta);
          opts.callbacks?.onTextDelta?.(chunk.delta);
        }
        if (chunk.toolCalls) {
          const merged = mergeStreamToolCallDeltas(toolAcc, chunk.toolCalls);
          assembler.setToolCalls(merged);
        }
        if (chunk.raw) {
          assembler.setRaw(chunk.raw, cfg.apiFormat);
        }
        if (chunk.usage) {
          const usage = parseLlmUsage(
            cfg.apiFormat === "anthropic"
              ? { usage: chunk.usage }
              : { usage: chunk.usage },
            cfg.apiFormat,
          );
          if (usage) {
            assembler.setUsage(usage);
            opts.callbacks?.onUsage?.(usage);
          }
        }
        if (chunk.done) {
          clearTimeout(timeout);
          opts.signal?.removeEventListener("abort", onAbort);
          finish();
        }
      }).then((fn) => {
        unlisten = fn;
      });
    },
  );
}

export function emitActivity(
  emit: (e: RuntimeEvent) => void,
  phase: AgentActivityPhase,
  label: string,
  detail?: string,
) {
  emit({ type: "activity", phase, label, detail });
}
