/**
 * @file Tauri LLM 端口适配（复用现有 stream / chatCompletion）
 */

import type {
  CoreLlmMessage,
  CoreToolDef,
  LlmPort,
  LlmRequestOpts,
  NormalizedLlmReply,
} from "@xuanjian/agent-core";
import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";
import type { ProviderBundle } from "@/lib/agent/runtime/provider";

let providerBundle: ProviderBundle | null = null;

export async function resolveAndCacheProvider(modelRef?: string | null) {
  const { resolveProvider } = await import("@/lib/agent/runtime/provider");
  providerBundle = await resolveProvider(modelRef);
  return providerBundle;
}

function toAppMessages(messages: CoreLlmMessage[]): LlmMessage[] {
  return messages as unknown as LlmMessage[];
}

function toAppTools(tools: CoreToolDef[]): AgentToolDef[] {
  return tools as unknown as AgentToolDef[];
}

function toCoreReply(reply: {
  text: string;
  thinking: string;
  toolCalls: NormalizedLlmReply["toolCalls"];
  usage?: NormalizedLlmReply["usage"];
  anthropicContent?: unknown;
}): NormalizedLlmReply {
  return {
    text: reply.text,
    thinking: reply.thinking,
    toolCalls: reply.toolCalls,
    usage: reply.usage,
    anthropicContent: reply.anthropicContent,
  };
}

/** 创建绑定当前 provider 的 LlmPort */
export function createTauriLlmPort(): LlmPort {
  return {
    async complete(messages, tools, opts) {
      if (!providerBundle) {
        throw new Error(
          "provider not resolved; call resolveAndCacheProvider first",
        );
      }
      const { chatCompletion } = await import("@/lib/agent/llm");
      const reply = await chatCompletion(
        {
          baseUrl: providerBundle.provider.base_url,
          apiFormat: providerBundle.provider.api_format,
          apiKey: providerBundle.apiKey,
          model: providerBundle.modelId,
          thinkingMode: opts?.thinkingMode ?? "high",
          maxTokens: providerBundle.maxTokens,
          signal: opts?.signal,
        },
        toAppMessages(messages),
        toAppTools(tools),
      );
      return toCoreReply({
        text: reply.text,
        thinking: reply.thinking,
        toolCalls: reply.toolCalls as NormalizedLlmReply["toolCalls"],
        usage: reply.usage ?? undefined,
        anthropicContent: reply.anthropicContent,
      });
    },

    async stream(messages, tools, opts: LlmRequestOpts = {}) {
      if (!providerBundle) {
        throw new Error(
          "provider not resolved; call resolveAndCacheProvider first",
        );
      }
      const { requestModelReply } = await import("@/lib/agent/llm/stream");
      const reply = await requestModelReply(
        providerBundle,
        toAppMessages(messages),
        toAppTools(tools),
        {
          thinkingMode: opts.thinkingMode ?? "high",
          signal: opts.signal,
          stream: opts.stream ?? true,
          callbacks: opts.callbacks
            ? {
                onTextDelta: opts.callbacks.onTextDelta,
                onThinkingDelta: opts.callbacks.onThinkingDelta,
                onUsage: opts.callbacks.onUsage as
                  | ((u: import("@/lib/agent/contextBudget").LlmUsage) => void)
                  | undefined,
              }
            : undefined,
        },
      );
      return toCoreReply({
        text: reply.text,
        thinking: reply.thinking,
        toolCalls: reply.toolCalls as NormalizedLlmReply["toolCalls"],
        usage: reply.usage ?? undefined,
        anthropicContent: reply.anthropicContent,
      });
    },
  };
}
