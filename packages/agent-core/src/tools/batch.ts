/**
 * @file 工具批处理（LoopPolicy + ports.tools / SubAgent）
 */

import type { LoopPolicy } from "../loop/policy";
import type { StopReason } from "../loop/types";
import { parseArgs } from "../parse-tool-args";
import type { AgentPorts } from "../ports";
import type {
  AgentPermissionMode,
  CoreLlmMessage,
  CoreLlmToolCall,
  MessagePart,
  NormalizedLlmReply,
  RuntimeEvent,
} from "../types";

export type ToolBatchConfig = {
  ports: AgentPorts;
  permissionMode: AgentPermissionMode;
  agentTag: string;
  emit: (e: RuntimeEvent) => void;
  onConfirmTool?: (req: {
    id: string;
    name: string;
    args: unknown;
    dangerous?: boolean;
  }) => Promise<boolean>;
  runSubAgent?: (opts: {
    kind: string;
    task: string;
    toolCallId: string;
    args: Record<string, unknown>;
  }) => Promise<{ ok: boolean; summary: string; children: MessagePart[] }>;
};

export type ToolBatchInput = {
  reply: NormalizedLlmReply;
  messages: CoreLlmMessage[];
  assistantParts: MessagePart[];
  policy: LoopPolicy;
  config: ToolBatchConfig;
};

export type ToolBatchResult = {
  messages: CoreLlmMessage[];
  assistantParts: MessagePart[];
  stopReason: StopReason | null;
};

function emitActivity(
  emit: (e: RuntimeEvent) => void,
  phase: import("../types").AgentActivityPhase,
  label: string,
  detail?: string,
) {
  emit({ type: "activity", phase, label, detail });
}

function pushToolObserve(
  tc: CoreLlmToolCall,
  name: string,
  args: Record<string, unknown>,
  content: string,
  agentTag: string,
  messages: CoreLlmMessage[],
  parts: MessagePart[],
  emit: (e: RuntimeEvent) => void,
) {
  parts.push({
    type: "tool_call",
    id: tc.id,
    name,
    args,
    agent: agentTag,
  });
  emit({
    type: "tool_call",
    id: tc.id,
    name,
    args,
    agent: agentTag,
  });
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    name,
    content,
  });
  parts.push({
    type: "tool_result",
    id: tc.id,
    name,
    result: content,
    agent: agentTag,
  });
  emit({
    type: "tool_result",
    id: tc.id,
    name,
    result: content,
    agent: agentTag,
  });
}

/**
 * 执行一轮模型给出的 tool_calls；环路决策只经 LoopPolicy。
 */
export async function runToolBatch(
  input: ToolBatchInput,
): Promise<ToolBatchResult> {
  const { reply, policy, config } = input;
  const messages = [...input.messages];
  const parts = [...input.assistantParts];
  const { emit, agentTag } = config;

  const thinking = reply.thinking.trim();
  if (thinking) {
    parts.push({ type: "thinking", text: thinking, agent: agentTag });
  }
  if (reply.text.trim()) {
    parts.push({ type: "text", text: reply.text.trim(), agent: agentTag });
  }

  messages.push({
    role: "assistant",
    content: reply.text || null,
    tool_calls: reply.toolCalls,
    anthropic_content: reply.anthropicContent,
  });

  for (const tc of reply.toolCalls) {
    if (policy.isStopped()) break;

    const name = tc.function.name;
    const args = parseArgs(tc.function.arguments);

    const before = policy.beforeTool(name, args);
    if (before.action === "observe") {
      pushToolObserve(
        tc,
        name,
        args,
        before.text,
        agentTag,
        messages,
        parts,
        emit,
      );
      if (!before.soft && before.stopReason) break;
      continue;
    }

    if (name === "run_subagent" && config.runSubAgent) {
      const kind = String(args.agent ?? args.kind ?? "inspector");
      const task = String(args.task ?? "");
      parts.push({
        type: "tool_call",
        id: tc.id,
        name,
        args,
        agent: agentTag,
      });
      emit({
        type: "tool_call",
        id: tc.id,
        name,
        args,
        agent: agentTag,
      });
      emit({
        type: "subagent_start",
        id: tc.id,
        agent: kind,
        label: kind,
        task,
      });
      const result = await config.runSubAgent({
        kind,
        task,
        toolCallId: tc.id,
        args,
      });
      const childPart: MessagePart = {
        type: "subagent",
        id: tc.id,
        agent: kind,
        label: kind,
        task,
        status: result.ok ? "done" : "error",
        summary: result.summary,
        children: result.children,
      };
      parts.push(childPart);
      emit({
        type: "subagent_end",
        id: tc.id,
        agent: kind,
        label: kind,
        ok: result.ok,
        summary: result.summary,
        children: result.children,
      });
      const resultText = JSON.stringify({
        ok: result.ok,
        summary: result.summary,
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name,
        content: resultText,
      });
      parts.push({
        type: "tool_result",
        id: tc.id,
        name,
        result: resultText,
        agent: agentTag,
      });
      const after = policy.afterTool(name, args, resultText);
      if (after.action === "stop") {
        messages[messages.length - 1] = {
          role: "tool",
          tool_call_id: tc.id,
          name,
          content: `${resultText}\n\n[系统] ${after.text}`,
        };
        break;
      }
      if (after.action === "observe") {
        const merged = `${resultText}\n\n[系统] ${after.text}`;
        messages[messages.length - 1] = {
          role: "tool",
          tool_call_id: tc.id,
          name,
          content: merged,
        };
        parts[parts.length - 1] = {
          type: "tool_result",
          id: tc.id,
          name,
          result: merged,
          agent: agentTag,
        };
      }
      continue;
    }

    if (
      config.permissionMode === "plan" &&
      config.ports.tools.isWriteTool(name)
    ) {
      const blocked = JSON.stringify({
        ok: false,
        blocked: true,
        reason: "计划模式禁止写操作",
      });
      pushToolObserve(tc, name, args, blocked, agentTag, messages, parts, emit);
      continue;
    }

    parts.push({
      type: "tool_call",
      id: tc.id,
      name,
      args,
      agent: agentTag,
    });
    emit({
      type: "tool_call",
      id: tc.id,
      name,
      args,
      agent: agentTag,
    });

    emitActivity(
      emit,
      "running_tool",
      "执行中…",
      typeof args.command === "string" ? String(args.command) : name,
    );

    let result = await config.ports.tools.execute(name, args, {
      permissionMode: config.permissionMode,
      toolCallId: tc.id,
      confirmTool: config.onConfirmTool,
      emit,
      agentTag,
    });

    const after = policy.afterTool(name, args, result);
    if (after.action === "observe" || after.action === "stop") {
      result = `${result}\n\n[系统] ${after.text}`;
    }

    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      name,
      content: result,
    });
    parts.push({
      type: "tool_result",
      id: tc.id,
      name,
      result,
      agent: agentTag,
    });
    emit({
      type: "tool_result",
      id: tc.id,
      name,
      result,
      agent: agentTag,
    });

    if (after.action === "stop") break;
  }

  return {
    messages,
    assistantParts: parts,
    stopReason: policy.stopReason,
  };
}
