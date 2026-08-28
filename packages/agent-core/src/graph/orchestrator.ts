/**
 * @file LangGraph Orchestrator（图路由；工具批处理与环路在 LoopPolicy / runToolBatch）
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph/web";
import { AgentInbox } from "../inbox";
import { AGENT_LIMITS } from "../limits";
import { LoopPolicy } from "../loop/policy";
import type { StopReason } from "../loop/types";
import { splitPlanFromReply } from "../plan";
import type { AgentPorts } from "../ports";
import { runToolBatch } from "../tools/batch";
import type {
  AgentPermissionMode,
  CoreLlmMessage,
  CoreLlmToolCall,
  CoreToolDef,
  MessagePart,
  NormalizedLlmReply,
  RuntimeEvent,
  ThinkingMode,
} from "../types";

export type OrchestratorConfig = {
  ports: AgentPorts;
  system: string;
  tools: CoreToolDef[];
  userText: string;
  permissionMode: AgentPermissionMode;
  thinkingMode: ThinkingMode;
  maxRounds: number;
  agentTag: string;
  agentLabel: string;
  depth: number;
  emit: (e: RuntimeEvent) => void;
  onConfirmTool?: (req: {
    id: string;
    name: string;
    args: unknown;
    dangerous?: boolean;
  }) => Promise<boolean>;
  signal?: AbortSignal;
  inbox: AgentInbox;
  sessionIdHint?: number;
  runSubAgent?: (opts: {
    kind: string;
    task: string;
    toolCallId: string;
    args: Record<string, unknown>;
    parent: OrchestratorConfig;
  }) => Promise<{ ok: boolean; summary: string; children: MessagePart[] }>;
  compactMessages?: (messages: CoreLlmMessage[]) => Promise<CoreLlmMessage[]>;
};

const AgentState = Annotation.Root({
  messages: Annotation<CoreLlmMessage[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  assistantParts: Annotation<MessagePart[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  rounds: Annotation<number>({
    reducer: (_l, r) => r,
    default: () => 0,
  }),
  emptyRounds: Annotation<number>({
    reducer: (_l, r) => r,
    default: () => 0,
  }),
  finished: Annotation<boolean>({
    reducer: (_l, r) => r,
    default: () => false,
  }),
  lastReply: Annotation<NormalizedLlmReply | null>({
    reducer: (_l, r) => r,
    default: () => null,
  }),
  wrapUp: Annotation<boolean>({
    reducer: (_l, r) => r,
    default: () => false,
  }),
  stopReason: Annotation<StopReason | null>({
    reducer: (_l, r) => r,
    default: () => null,
  }),
});

export type AgentGraphState = typeof AgentState.State;

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
}

function isEmptyReply(reply: NormalizedLlmReply): boolean {
  return (
    !reply.thinking.trim() && !reply.text.trim() && reply.toolCalls.length === 0
  );
}

function emitActivity(
  emit: (e: RuntimeEvent) => void,
  phase: import("../types").AgentActivityPhase,
  label: string,
  detail?: string,
) {
  emit({ type: "activity", phase, label, detail });
}

function applyStop(
  reason: StopReason,
  policy: LoopPolicy,
): Partial<AgentGraphState> {
  policy.applyStop(reason);
  return { stopReason: reason, wrapUp: true, finished: true };
}

export function buildOrchestratorGraph(config: OrchestratorConfig) {
  const policy = new LoopPolicy({
    maxCalls:
      config.depth === 0
        ? AGENT_LIMITS.ORCH_MAX_TOOL_CALLS
        : AGENT_LIMITS.SUB_MAX_TOOL_CALLS,
  });

  const preStep = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    checkAbort(config.signal);
    if (state.stopReason || policy.isStopped() || policy.checkWallClock()) {
      const reason =
        state.stopReason ?? policy.stopReason ?? ("wall_clock" as StopReason);
      return applyStop(reason, policy);
    }
    if (state.rounds >= config.maxRounds) {
      return applyStop("max_rounds", policy);
    }

    let messages = [...state.messages];
    for (const m of config.inbox.drainAsUserMessages()) {
      messages.push(m);
    }
    if (config.compactMessages) {
      messages = await config.compactMessages(messages);
    }
    return {
      messages,
      rounds: state.rounds + 1,
      wrapUp: false,
    };
  };

  const callModel = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    checkAbort(config.signal);
    const thinkingEnabled = config.thinkingMode !== "off";
    emitActivity(
      config.emit,
      "calling_model",
      thinkingEnabled ? "思考中…" : "处理中…",
    );

    const preMessages: CoreLlmMessage[] = [
      { role: "system", content: config.system },
      ...state.messages,
    ];

    try {
      const reply = await config.ports.llm.stream(preMessages, config.tools, {
        thinkingMode: config.thinkingMode,
        signal: config.signal,
        stream: true,
        callbacks: {
          onTextDelta: (d) =>
            config.emit({
              type: "text_delta",
              text: d,
              agent: config.agentTag,
            }),
          onThinkingDelta: (d) =>
            config.emit({
              type: "thinking_delta",
              text: d,
              agent: config.agentTag,
            }),
          onUsage: (u) =>
            config.emit({ type: "usage", usage: u, agent: config.agentTag }),
        },
      });
      return { lastReply: reply };
    } catch (e) {
      const msg = String(e);
      config.emit({ type: "error", text: msg });
      const parts = [
        ...state.assistantParts,
        { type: "text" as const, text: msg, agent: config.agentTag },
      ];
      policy.applyStop("error");
      return {
        lastReply: null,
        assistantParts: parts,
        finished: true,
        wrapUp: true,
        stopReason: "error",
      };
    }
  };

  const routeAfterModel = (
    state: AgentGraphState,
  ): "executeTools" | "finalize" | "continueEmpty" => {
    if (state.finished || state.wrapUp || state.stopReason || !state.lastReply) {
      return "finalize";
    }
    if (isEmptyReply(state.lastReply)) return "continueEmpty";
    if (state.lastReply.toolCalls.length > 0) return "executeTools";
    return "finalize";
  };

  const continueEmpty = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    const emptyRounds = state.emptyRounds + 1;
    if (emptyRounds >= AGENT_LIMITS.MAX_EMPTY_ROUNDS) {
      return {
        emptyRounds,
        ...applyStop("empty_replies", policy),
      };
    }
    const messages: CoreLlmMessage[] = [
      ...state.messages,
      { role: "assistant", content: "(空回复)" },
      {
        role: "user",
        content:
          "（系统）你上一轮没有有效输出。请直接回答用户，或调用工具并说明原因；不要留空。",
      },
    ];
    return { messages, emptyRounds, lastReply: null };
  };

  const executeTools = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    checkAbort(config.signal);
    const batch = await runToolBatch({
      reply: state.lastReply!,
      messages: state.messages,
      assistantParts: state.assistantParts,
      policy,
      config: {
        ports: config.ports,
        permissionMode: config.permissionMode,
        agentTag: config.agentTag,
        emit: config.emit,
        onConfirmTool: config.onConfirmTool,
        runSubAgent: config.runSubAgent
          ? (opts) =>
              config.runSubAgent!({
                ...opts,
                parent: config,
              })
          : undefined,
      },
    });

    const stopped = batch.stopReason != null;
    return {
      messages: batch.messages,
      assistantParts: batch.assistantParts,
      lastReply: null,
      emptyRounds: 0,
      finished: false,
      stopReason: batch.stopReason,
      wrapUp: stopped,
    };
  };

  const finalize = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    const parts = [...state.assistantParts];
    const reply = state.lastReply;

    if (reply && !isEmptyReply(reply) && reply.toolCalls.length === 0) {
      const thinking = reply.thinking.trim();
      if (thinking) {
        parts.push({
          type: "thinking",
          text: thinking,
          agent: config.agentTag,
        });
      }
      const text = reply.text.trim();
      if (text) {
        if (config.permissionMode === "plan" && config.depth === 0) {
          const { body, planItems } = splitPlanFromReply(text);
          parts.push({
            type: "text",
            text: body,
            agent: config.agentTag,
          });
          if (planItems?.length) {
            parts.push({ type: "plan", items: planItems });
            config.emit({ type: "plan", items: planItems });
          }
        } else {
          parts.push({
            type: "text",
            text,
            agent: config.agentTag,
          });
        }
      }
    }

    if (
      (state.wrapUp || state.stopReason) &&
      !parts.some((p) => p.type === "text" && p.text.trim())
    ) {
      const fallback =
        "根据目前掌握的信息，我还无法给出完整结论。你可以补充目标环境，或告诉我希望优先排查哪一块。";
      parts.push({ type: "text", text: fallback, agent: config.agentTag });
      config.emit({ type: "text", text: fallback, agent: config.agentTag });
    }

    return { assistantParts: parts, finished: true };
  };

  const shouldLoop = (state: AgentGraphState): "preStep" | typeof END => {
    if (
      state.finished ||
      state.wrapUp ||
      state.stopReason ||
      policy.isStopped()
    ) {
      return END;
    }
    if (state.rounds >= config.maxRounds) return END;
    return "preStep";
  };

  const routeAfterPreStep = (
    state: AgentGraphState,
  ): "callModel" | "finalize" => {
    if (
      state.wrapUp ||
      state.finished ||
      state.stopReason ||
      policy.isStopped()
    ) {
      return "finalize";
    }
    return "callModel";
  };

  const graph = new StateGraph(AgentState)
    .addNode("preStep", preStep)
    .addNode("callModel", callModel)
    .addNode("continueEmpty", continueEmpty)
    .addNode("executeTools", executeTools)
    .addNode("finalize", finalize)
    .addEdge(START, "preStep")
    .addConditionalEdges("preStep", routeAfterPreStep, {
      callModel: "callModel",
      finalize: "finalize",
    })
    .addConditionalEdges("callModel", routeAfterModel, {
      executeTools: "executeTools",
      finalize: "finalize",
      continueEmpty: "continueEmpty",
    })
    .addConditionalEdges("continueEmpty", shouldLoop, {
      preStep: "preStep",
      [END]: END,
    })
    .addConditionalEdges("executeTools", shouldLoop, {
      preStep: "preStep",
      [END]: END,
    })
    .addEdge("finalize", END);

  return graph.compile();
}

export async function runOrchestratorGraph(
  config: OrchestratorConfig,
  history: CoreLlmMessage[],
): Promise<MessagePart[]> {
  const compiled = buildOrchestratorGraph(config);
  const initial: AgentGraphState = {
    messages: [...history, { role: "user", content: config.userText }],
    assistantParts: [],
    rounds: 0,
    emptyRounds: 0,
    finished: false,
    lastReply: null,
    wrapUp: false,
    stopReason: null,
  };

  const finalState = await compiled.invoke(initial, {
    recursionLimit: Math.max(config.maxRounds * 4, 100),
  });

  return finalState.assistantParts ?? [];
}

export type { CoreLlmToolCall };
