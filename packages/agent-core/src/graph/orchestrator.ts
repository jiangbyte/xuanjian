/**
 * @file LangGraph Orchestrator 状态与图
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph/web";
import type { AgentPorts } from "../ports";
import { AgentInbox } from "../inbox";
import { ReactLoopGuard, REACT_LIMITS } from "../guards";
import { splitPlanFromReply } from "../plan";
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
  /** SubAgent 派发（由 adapters/app 注入，避免 core 循环依赖） */
  runSubAgent?: (opts: {
    kind: string;
    task: string;
    toolCallId: string;
    args: Record<string, unknown>;
    parent: OrchestratorConfig;
  }) => Promise<{ ok: boolean; summary: string; children: MessagePart[] }>;
  /** 可选：每步前压缩消息 */
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

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function buildOrchestratorGraph(config: OrchestratorConfig) {
  const guard = new ReactLoopGuard(
    config.depth === 0
      ? REACT_LIMITS.ORCH_MAX_TOOL_CALLS
      : REACT_LIMITS.SUB_MAX_TOOL_CALLS,
  );

  const preStep = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    checkAbort(config.signal);
    if (guard.shouldWrapUp || guard.checkWallClock()) {
      return { wrapUp: true, finished: true };
    }
    if (state.rounds >= config.maxRounds) {
      guard.markWrapUp("max_rounds");
      return { wrapUp: true, finished: true };
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
      return {
        lastReply: null,
        assistantParts: parts,
        finished: true,
        wrapUp: true,
      };
    }
  };

  const routeAfterModel = (
    state: AgentGraphState,
  ): "executeTools" | "finalize" | "continueEmpty" => {
    if (state.finished || state.wrapUp || !state.lastReply) return "finalize";
    if (isEmptyReply(state.lastReply)) return "continueEmpty";
    if (state.lastReply.toolCalls.length > 0) return "executeTools";
    return "finalize";
  };

  const continueEmpty = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    const emptyRounds = state.emptyRounds + 1;
    if (emptyRounds >= REACT_LIMITS.MAX_EMPTY_ROUNDS) {
      guard.markWrapUp("empty_replies");
      return { emptyRounds, wrapUp: true, finished: true };
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
    const reply = state.lastReply!;
    let messages = [...state.messages];
    let parts = [...state.assistantParts];

    const thinking = reply.thinking.trim();
    if (thinking) {
      parts.push({
        type: "thinking",
        text: thinking,
        agent: config.agentTag,
      });
    }
    if (reply.text.trim()) {
      parts.push({
        type: "text",
        text: reply.text.trim(),
        agent: config.agentTag,
      });
    }

    messages.push({
      role: "assistant",
      content: reply.text || null,
      tool_calls: reply.toolCalls,
      anthropic_content: reply.anthropicContent,
    });

    for (const tc of reply.toolCalls) {
      const name = tc.function.name;
      const args = parseArgs(tc.function.arguments);
      const guardObs = guard.beforeToolCall(name, args);
      if (guardObs) {
        parts.push({
          type: "tool_call",
          id: tc.id,
          name,
          args,
          agent: config.agentTag,
        });
        config.emit({
          type: "tool_call",
          id: tc.id,
          name,
          args,
          agent: config.agentTag,
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name,
          content: guardObs,
        });
        parts.push({
          type: "tool_result",
          id: tc.id,
          name,
          result: guardObs,
          agent: config.agentTag,
        });
        config.emit({
          type: "tool_result",
          id: tc.id,
          name,
          result: guardObs,
          agent: config.agentTag,
        });
        if (guard.shouldWrapUp) break;
        continue;
      }
      if (guard.shouldWrapUp) break;

      if (name === "run_subagent" && config.runSubAgent) {
        const kind = String(args.agent ?? args.kind ?? "inspector");
        const task = String(args.task ?? "");
        parts.push({
          type: "tool_call",
          id: tc.id,
          name,
          args,
          agent: config.agentTag,
        });
        config.emit({
          type: "tool_call",
          id: tc.id,
          name,
          args,
          agent: config.agentTag,
        });
        config.emit({
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
          parent: config,
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
        config.emit({
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
          agent: config.agentTag,
        });
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
        parts.push({
          type: "tool_call",
          id: tc.id,
          name,
          args,
          agent: config.agentTag,
        });
        config.emit({
          type: "tool_call",
          id: tc.id,
          name,
          args,
          agent: config.agentTag,
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name,
          content: blocked,
        });
        parts.push({
          type: "tool_result",
          id: tc.id,
          name,
          result: blocked,
          agent: config.agentTag,
        });
        config.emit({
          type: "tool_result",
          id: tc.id,
          name,
          result: blocked,
          agent: config.agentTag,
        });
        continue;
      }

      parts.push({
        type: "tool_call",
        id: tc.id,
        name,
        args,
        agent: config.agentTag,
      });
      config.emit({
        type: "tool_call",
        id: tc.id,
        name,
        args,
        agent: config.agentTag,
      });

      emitActivity(
        config.emit,
        "running_tool",
        "执行中…",
        typeof args.command === "string" ? String(args.command) : name,
      );

      const result = await config.ports.tools.execute(name, args, {
        permissionMode: config.permissionMode,
        toolCallId: tc.id,
        confirmTool: config.onConfirmTool,
        emit: config.emit,
        agentTag: config.agentTag,
      });

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
        agent: config.agentTag,
      });
      config.emit({
        type: "tool_result",
        id: tc.id,
        name,
        result,
        agent: config.agentTag,
      });
    }

    return {
      messages,
      assistantParts: parts,
      lastReply: null,
      emptyRounds: 0,
      finished: false,
    };
  };

  const finalize = async (
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> => {
    let parts = [...state.assistantParts];
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
      state.wrapUp &&
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
    if (state.finished || state.wrapUp || guard.shouldWrapUp) return END;
    if (state.rounds >= config.maxRounds) return END;
    return "preStep";
  };

  const routeAfterPreStep = (
    state: AgentGraphState,
  ): "callModel" | "finalize" => {
    if (state.wrapUp || state.finished || guard.shouldWrapUp) return "finalize";
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
  };

  const finalState = await compiled.invoke(initial, {
    recursionLimit: Math.max(config.maxRounds * 4, 100),
  });

  return finalState.assistantParts ?? [];
}

export type { CoreLlmToolCall };
