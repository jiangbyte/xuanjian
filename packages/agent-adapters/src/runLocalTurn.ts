/**
 * @file 组装默认本地 Agent 端口并运行 LangGraph turn
 */

import {
  getSessionInbox,
  REACT_LIMITS,
  type AgentPorts,
  type CoreLlmMessage,
  type CoreToolDef,
  type MessagePart,
  type OrchestratorConfig,
  type RunAgentInput,
  type RuntimeEvent,
} from "@xuanjian/agent-core";
import { runOrchestratorGraph } from "@xuanjian/agent-core/graph";
import {
  createTauriLlmPort,
  resolveAndCacheProvider,
} from "./llm/TauriLlmPort";
import { createTauriToolPort } from "./tools/TauriToolPort";
import {
  createExecutionContextPort,
  createProviderPort,
  createSessionPort,
} from "./session/ports";

export function createDefaultPorts(): AgentPorts {
  return {
    llm: createTauriLlmPort(),
    tools: createTauriToolPort(),
    execution: createExecutionContextPort(),
    session: createSessionPort(),
    provider: createProviderPort(),
  };
}

async function runSubAgentAction(opts: {
  kind: string;
  task: string;
  toolCallId: string;
  args: Record<string, unknown>;
  parent: OrchestratorConfig;
}): Promise<{ ok: boolean; summary: string; children: MessagePart[] }> {
  const {
    SUB_AGENTS,
    toolsForSubAgent,
    isSubAgentKind,
  } = await import("@/lib/agent/subagents");
  const { buildSubAgentSystemWithContext } = await import(
    "@/lib/agent/prompts"
  );
  const { normalizeSubAgentArgs } = await import("@xuanjian/agent-core");


  const normalized = normalizeSubAgentArgs(opts.args);
  const kindRaw = normalized.agent ?? opts.kind;
  const task = normalized.task ?? opts.task;
  if (!isSubAgentKind(kindRaw) || !task) {
    return {
      ok: false,
      summary:
        "run_subagent 需要 agent(terminal|inspector|analyst|network|docker|deploy) 与 task",
      children: [],
    };
  }

  const def = SUB_AGENTS[kindRaw];
  const system = await buildSubAgentSystemWithContext(def.systemExtra);
  const tools = toolsForSubAgent(kindRaw) as unknown as CoreToolDef[];

  const children = await runOrchestratorGraph(
    {
      ports: opts.parent.ports,
      system,
      tools,
      userText: task,
      permissionMode: opts.parent.permissionMode,
      thinkingMode: opts.parent.thinkingMode,
      maxRounds: Math.min(def.maxRounds * 3, REACT_LIMITS.SUB_MAX_ROUNDS),
      agentTag: kindRaw,
      agentLabel: def.label,
      depth: opts.parent.depth + 1,
      emit: opts.parent.emit,
      onConfirmTool: opts.parent.onConfirmTool,
      signal: opts.parent.signal,
      inbox: getSessionInbox(-(opts.parent.sessionIdHint ?? 1) - opts.parent.depth),
      runSubAgent: opts.parent.depth >= 2 ? undefined : runSubAgentAction,
      compactMessages: opts.parent.compactMessages,
      sessionIdHint: opts.parent.sessionIdHint,
    },
    [],
  );

  const summary =
    children
      .filter(
        (p): p is Extract<MessagePart, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("\n")
      .trim() || "(无摘要)";

  return { ok: true, summary, children };
}

/** 本地 LangGraph Agent 一轮 */
export async function runAgentTurn(input: RunAgentInput): Promise<void> {
  const ports = createDefaultPorts();
  await resolveAndCacheProvider(input.modelRef);
  const { refreshAllTools } = await import("@/lib/agent/tools");
  await refreshAllTools();

  const { buildOrchestratorSystemWithContext } = await import(
    "@/lib/agent/prompts"
  );
  const { toolsForOrchestrator } = await import("@/lib/agent/subagents");

  const emit = (e: RuntimeEvent) => input.onEvent(e);
  emit({
    type: "activity",
    phase: "planning",
    label: "处理中…",
  });

  const inbox = getSessionInbox(input.sessionId);
  const ctxBlock = await ports.execution.snapshotIfChanged?.();
  if (ctxBlock) inbox.inject(ctxBlock);

  const system = await buildOrchestratorSystemWithContext(input.permissionMode);
  const tools = toolsForOrchestrator(
    input.permissionMode,
  ) as unknown as CoreToolDef[];

  const { compactLlmMessagesForModel } = await import(
    "@/lib/agent/compaction"
  );
  const compactMessages = async (messages: CoreLlmMessage[]) =>
    compactLlmMessagesForModel(
      messages as import("@/lib/agent/llm").LlmMessage[],
    ) as CoreLlmMessage[];

  const parts = await runOrchestratorGraph(
    {
      ports,
      system,
      tools,
      userText: input.userText,
      permissionMode: input.permissionMode,
      thinkingMode: input.thinkingMode ?? "high",
      maxRounds: REACT_LIMITS.ORCH_MAX_ROUNDS,
      agentTag: "orchestrator",
      agentLabel: "编排器",
      depth: 0,
      emit,
      onConfirmTool: input.onConfirmTool,
      signal: input.signal,
      inbox,
      runSubAgent: runSubAgentAction,
      compactMessages,
      sessionIdHint: input.sessionId,
    },
    input.history,
  );

  await ports.session.appendAssistant(
    input.sessionId,
    parts.length ? parts : [{ type: "text", text: "(无回复)" }],
  );
  emit({ type: "activity", phase: "idle", label: "空闲" });
  emit({ type: "done" });
}
