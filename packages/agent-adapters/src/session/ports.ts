/**
 * @file ExecutionContext / Session / Provider 适配器
 */

import type {
  CoreLlmMessage,
  ExecutionContextPort,
  ExecutionSnapshot,
  MessagePart,
  ProviderPort,
  SessionPort,
} from "@xuanjian/agent-core";

export function createExecutionContextPort(): ExecutionContextPort {
  return {
    async snapshot(): Promise<ExecutionSnapshot> {
      const { buildExecutionContextBlock } = await import(
        "@/lib/agent/runtime/executionContext"
      );
      const block = await buildExecutionContextBlock();
      return {
        tabId: null,
        plane: "unknown",
        block,
      };
    },
    async snapshotIfChanged() {
      const { buildExecutionContextBlockIfChanged } = await import(
        "@/lib/agent/runtime/executionContext"
      );
      return buildExecutionContextBlockIfChanged();
    },
  };
}

export function createSessionPort(): SessionPort {
  return {
    async loadHistory(sessionId) {
      const { buildAgentHistory } = await import("@/lib/agent/history");
      return (await buildAgentHistory(sessionId)) as CoreLlmMessage[];
    },
    async appendUser(sessionId, text) {
      const { appendAgentMessage } = await import("@/lib/db");
      await appendAgentMessage({
        session_id: sessionId,
        role: "user",
        parts: [{ type: "text", text }],
      });
    },
    async appendAssistant(sessionId, parts) {
      const { appendAgentMessage } = await import("@/lib/db");
      await appendAgentMessage({
        session_id: sessionId,
        role: "assistant",
        parts: parts as import("@/lib/db").MessagePart[],
      });
    },
  };
}

export function createProviderPort(): ProviderPort {
  return {
    async resolve(modelRef) {
      const { resolveProvider } = await import("@/lib/agent/runtime/provider");
      const p = await resolveProvider(modelRef);
      return {
        modelId: p.modelId,
        contextTag: p.contextTag,
        maxTokens: p.maxTokens ?? 0,
      };
    },
  };
}

export type { MessagePart };
