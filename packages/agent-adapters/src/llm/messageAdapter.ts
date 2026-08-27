/**
 * @file LlmMessage ↔ Core / BaseMessage 适配
 */

import type { CoreLlmMessage, CoreLlmToolCall } from "@xuanjian/agent-core";

/** 将应用层 LlmMessage 规范为 CoreLlmMessage */
export function toCoreMessages(messages: unknown[]): CoreLlmMessage[] {
  return messages as CoreLlmMessage[];
}

export function toolCallsFromReply(
  toolCalls: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
  }>,
): CoreLlmToolCall[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}
