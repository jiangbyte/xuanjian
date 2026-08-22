/**
 * @file 工程级 ReAct：编排器 + SubAgent（Thought → Action → Observation）
 * @author Charlie
 */

import {
  appendAgentMessage,
  decodeModelRef,
  listAiModels,
  listAiProviders,
  type MessagePart,
} from "@/lib/db";
import { stripAnsi } from "@/lib/agent/ansi";
import {
  chatCompletion,
  type LlmMessage,
  type LlmToolCall,
} from "@/lib/agent/llm";
import {
  isSubAgentKind,
  SUB_AGENTS,
  toolsForOrchestrator,
  toolsForSubAgent,
  type SubAgentKind,
} from "@/lib/agent/subagents";
import {
  executeLocalTool,
  isWriteTool,
  type AgentToolDef,
} from "@/lib/agent/tools";
import type {
  AgentActivityPhase,
  RunAgentInput,
  RuntimeEvent,
} from "@/lib/agent/types";

const ORCH_MAX_ROUNDS = 12;

type ProviderBundle = Awaited<ReturnType<typeof resolveProvider>>;

type LoopOpts = {
  input: RunAgentInput;
  provider: ProviderBundle;
  system: string;
  tools: AgentToolDef[];
  userText: string;
  history: LlmMessage[];
  maxRounds: number;
  agentTag: string;
  agentLabel: string;
  /** 子循环不落库，只返回 parts + 文本摘要 */
  persist: boolean;
  depth: number;
};

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
}

function orchestratorSystem(mode: RunAgentInput["permissionMode"]): string {
  const modeLine =
    mode === "plan"
      ? "【权限=计划】禁止写操作与 terminal SubAgent 执行命令；可用 inspector 只读收集后给出分步计划。"
      : mode === "confirm"
        ? "【权限=确认执行】写操作与 terminal SubAgent 的命令会要求用户确认。"
        : "【权限=完全执行】可直接派发执行；危险命令仍会二次确认。";

  return [
    "你是玄鉴 Orchestrator（编排 Agent）。",
    "复杂任务请拆解并用 run_subagent 派发给专职 SubAgent，而不是自己一把梭：",
    "- inspector：只读巡检（主机/会话/指标/读终端/脚本库/历史命令）",
    "- terminal：在可见终端执行命令，或 run_script 复用脚本库",
    "- analyst：归纳结论与建议",
    "本地能力：list_scripts / get_script 查阅脚本库；list_cmd_history 查阅历史命令；合适时优先复用而非手写。",
    "简单一问一答可直接用本地工具，不必强行派发。",
    "遵循 ReAct：Thought → Action → Observation；禁止编造 Observation。",
    "优先中文。",
    modeLine,
  ].join("\n");
}

async function resolveProvider(modelRef: string | null | undefined) {
  const providers = await listAiProviders();
  const models = await listAiModels();
  const decoded = decodeModelRef(modelRef);
  let provider = providers.find(
    (p) => p.enabled && p.id === decoded?.providerId,
  );
  let modelId = decoded?.modelId;
  if (!provider) provider = providers.find((p) => p.enabled);
  if (!provider) throw new Error("未配置 AI 供应商，请在设置中添加");
  if (!modelId) {
    const m = models.find((x) => x.provider_id === provider!.id && x.enabled);
    modelId = m?.model_id;
  }
  if (!modelId) throw new Error("未配置模型");
  let apiKey = "";
  if (provider.api_key_enc) {
    try {
      const { api } = await import("@/lib/tauri");
      apiKey = await api.decryptSecret(provider.api_key_enc);
    } catch {
      apiKey = provider.api_key_enc;
    }
  }
  const modelRow = models.find(
    (x) => x.provider_id === provider.id && x.model_id === modelId,
  );
  const maxTokens =
    modelRow?.max_output_tokens && modelRow.max_output_tokens > 0
      ? modelRow.max_output_tokens
      : undefined;
  return { provider, modelId, apiKey, maxTokens };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tryExtractPlan(text: string): string[] | null {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+[\.\)、]/.test(l) || /^- /.test(l));
  if (lines.length >= 2) {
    return lines.map((l) => l.replace(/^\d+[\.\)、]\s*/, "").replace(/^- /, ""));
  }
  return null;
}

function emitActivity(
  emit: (e: RuntimeEvent) => void,
  phase: AgentActivityPhase,
  label: string,
  detail?: string,
) {
  emit({ type: "activity", phase, label, detail });
}

/**
 * 本地编排入口：Orchestrator ReAct + 可派发 SubAgent。
 */
export async function runLocalReAct(input: RunAgentInput): Promise<void> {
  const provider = await resolveProvider(input.modelRef);
  const emit = (e: RuntimeEvent) => input.onEvent(e);
  emitActivity(emit, "planning", "编排器准备中…");

  const parts = await runReActLoop({
    input,
    provider,
    system: orchestratorSystem(input.permissionMode),
    tools: toolsForOrchestrator(input.permissionMode),
    userText: input.userText,
    history: input.history.map((h) => ({
      role: h.role,
      content: h.content,
    })),
    maxRounds: ORCH_MAX_ROUNDS,
    agentTag: "orchestrator",
    agentLabel: "编排器",
    persist: true,
    depth: 0,
  });

  await appendAgentMessage({
    session_id: input.sessionId,
    role: "assistant",
    parts: parts.length ? parts : [{ type: "text", text: "(无回复)" }],
  });
  emitActivity(emit, "idle", "空闲");
  emit({ type: "done" });
}

async function runReActLoop(opts: LoopOpts): Promise<MessagePart[]> {
  const { input, provider } = opts;
  const emit = (e: RuntimeEvent) => opts.input.onEvent(e);
  const assistantParts: MessagePart[] = [];
  const messages: LlmMessage[] = [
    { role: "system", content: opts.system },
    ...opts.history,
    { role: "user", content: opts.userText },
  ];

  let rounds = 0;
  let lastText = "";

  while (rounds < opts.maxRounds) {
    checkAbort(input.signal);
    rounds += 1;
    emit({
      type: "status",
      text: `${opts.agentLabel} · ReAct #${rounds}`,
    });
    emitActivity(
      emit,
      "calling_model",
      (input.thinkingMode ?? "high") === "off"
        ? `${opts.agentLabel} 正在调用模型…`
        : `${opts.agentLabel} 正在思考…`,
      `#${rounds}`,
    );

    const reply = await chatCompletion(
      {
        baseUrl: provider.provider.base_url,
        apiFormat: provider.provider.api_format,
        apiKey: provider.apiKey,
        model: provider.modelId,
        thinkingMode: input.thinkingMode ?? "high",
        maxTokens: provider.maxTokens,
      },
      messages,
      opts.tools,
    );

    checkAbort(input.signal);

    const thinkingEnabled = (input.thinkingMode ?? "high") !== "off";
    let thinking = thinkingEnabled ? reply.thinking.trim() : "";
    // 仅在开启思考时，把「带 tool call 的前置正文」视为 Thought；关闭时不当作思考
    if (
      thinkingEnabled &&
      !thinking &&
      reply.toolCalls.length &&
      reply.text.trim()
    ) {
      thinking = reply.text.trim();
    }
    if (thinking) {
      emitActivity(emit, "thinking", `${opts.agentLabel} · Thought`);
      assistantParts.push({
        type: "thinking",
        text: thinking,
        agent: opts.agentTag,
      });
      emit({
        type: "thinking",
        text: thinking,
        agent: opts.agentTag,
      });
    }

    if (!reply.toolCalls.length) {
      const text =
        thinking && reply.text.trim() === thinking
          ? ""
          : reply.text.trim();
      if (text) {
        lastText = text;
        assistantParts.push({
          type: "text",
          text,
          agent: opts.agentTag,
        });
        emit({ type: "text", text, agent: opts.agentTag });
        if (input.permissionMode === "plan" && opts.depth === 0) {
          const items = tryExtractPlan(text);
          if (items) {
            assistantParts.push({ type: "plan", items });
            emit({ type: "plan", items });
          }
        }
      } else if (!thinking) {
        lastText = "(无回复)";
        assistantParts.push({ type: "text", text: lastText });
        emit({ type: "text", text: lastText });
      } else {
        lastText = thinking;
      }
      break;
    }

    // 有 tool call：关闭思考时，前置正文按普通文本展示，不进 Thought
    if (
      reply.text.trim() &&
      !(thinking && reply.text.trim() === thinking)
    ) {
      lastText = reply.text.trim();
      assistantParts.push({
        type: "text",
        text: lastText,
        agent: opts.agentTag,
      });
      emit({ type: "text", text: lastText, agent: opts.agentTag });
    }

    messages.push({
      role: "assistant",
      content: reply.text || null,
      tool_calls: reply.toolCalls,
      anthropic_content: reply.anthropicContent,
    });

    for (const tc of reply.toolCalls) {
      checkAbort(input.signal);
      await runOneAction(tc, opts, assistantParts, messages, emit);
    }
  }

  void lastText;
  return assistantParts;
}

async function runOneAction(
  tc: LlmToolCall,
  opts: LoopOpts,
  assistantParts: MessagePart[],
  messages: LlmMessage[],
  emit: (e: RuntimeEvent) => void,
) {
  const args = parseArgs(tc.function.arguments);
  const name = tc.function.name;
  const { input } = opts;

  if (name === "run_subagent") {
    await runSubAgentAction(tc, args, opts, assistantParts, messages, emit);
    return;
  }

  assistantParts.push({
    type: "tool_call",
    id: tc.id,
    name,
    args,
    agent: opts.agentTag,
  });
  emit({
    type: "tool_call",
    id: tc.id,
    name,
    args,
    agent: opts.agentTag,
  });

  if (input.permissionMode === "plan" && isWriteTool(name)) {
    const result = JSON.stringify({
      ok: false,
      blocked: true,
      reason: "计划模式禁止写操作",
    });
    pushResult(assistantParts, messages, emit, tc, name, result, opts.agentTag);
    return;
  }

  emitActivity(
    emit,
    "running_tool",
    `${opts.agentLabel} 执行 ${name}`,
    typeof args.command === "string" ? String(args.command) : undefined,
  );

  const resultRaw = await executeLocalTool(name, args, {
    permissionMode: input.permissionMode,
    confirmTool: async (info) => {
      emitActivity(emit, "awaiting_confirm", "等待你确认操作…", info.name);
      emit({
        type: "tool_pending",
        id: tc.id,
        name: info.name,
        args: info.args,
        dangerous: info.dangerous,
        agent: opts.agentTag,
      });
      if (!input.onConfirmTool) return false;
      return input.onConfirmTool({
        id: tc.id,
        name: info.name,
        args: info.args,
        dangerous: info.dangerous,
      });
    },
  });

  const result = stripAnsi(resultRaw);
  pushResult(assistantParts, messages, emit, tc, name, result, opts.agentTag);
}

function pushResult(
  assistantParts: MessagePart[],
  messages: LlmMessage[],
  emit: (e: RuntimeEvent) => void,
  tc: LlmToolCall,
  name: string,
  result: string,
  agent: string,
) {
  assistantParts.push({
    type: "tool_result",
    id: tc.id,
    name,
    result,
    agent,
  });
  emit({ type: "tool_result", id: tc.id, name, result, agent });
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    name,
    content: result,
  });
}

async function runSubAgentAction(
  tc: LlmToolCall,
  args: Record<string, unknown>,
  opts: LoopOpts,
  assistantParts: MessagePart[],
  messages: LlmMessage[],
  emit: (e: RuntimeEvent) => void,
) {
  const kindRaw = args.agent;
  const task = String(args.task ?? "").trim();
  if (!isSubAgentKind(kindRaw) || !task) {
    const result = JSON.stringify({
      ok: false,
      error: "run_subagent 需要 agent(terminal|inspector|analyst) 与 task",
    });
    pushResult(
      assistantParts,
      messages,
      emit,
      tc,
      "run_subagent",
      result,
      opts.agentTag,
    );
    return;
  }

  if (opts.depth >= 2) {
    const result = JSON.stringify({
      ok: false,
      error: "SubAgent 不可再嵌套派发",
    });
    pushResult(
      assistantParts,
      messages,
      emit,
      tc,
      "run_subagent",
      result,
      opts.agentTag,
    );
    return;
  }

  const kind = kindRaw as SubAgentKind;
  const def = SUB_AGENTS[kind];

  // plan 模式禁止 terminal 写执行
  if (opts.input.permissionMode === "plan" && kind === "terminal") {
    const result = JSON.stringify({
      ok: false,
      blocked: true,
      reason: "计划模式不可派发终端执行 SubAgent",
    });
    pushResult(
      assistantParts,
      messages,
      emit,
      tc,
      "run_subagent",
      result,
      opts.agentTag,
    );
    return;
  }

  const subId = tc.id;
  emit({
    type: "subagent_start",
    id: subId,
    agent: kind,
    label: def.label,
    task,
  });
  emitActivity(emit, "subagent", `SubAgent · ${def.label}`, task.slice(0, 80));

  assistantParts.push({
    type: "subagent",
    id: subId,
    agent: kind,
    label: def.label,
    task,
    status: "running",
  });

  let ok = true;
  let summary = "";
  try {
    const childParts = await runReActLoop({
      input: opts.input,
      provider: opts.provider,
      system: [
        def.systemExtra,
        `父任务上下文由编排器下达。你的任务：${task}`,
        opts.input.permissionMode === "confirm"
          ? "写操作需用户确认。"
          : opts.input.permissionMode === "full"
            ? "可执行写操作；危险命令仍确认。"
            : "只读。",
      ].join("\n"),
      tools: toolsForSubAgent(kind),
      userText: task,
      history: [],
      maxRounds: def.maxRounds,
      agentTag: kind,
      agentLabel: def.label,
      persist: false,
      depth: opts.depth + 1,
    });

    summary = childParts
      .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (!summary) {
      summary =
        childParts
          .filter(
            (p): p is Extract<MessagePart, { type: "thinking" }> =>
              p.type === "thinking",
          )
          .map((p) => p.text)
          .slice(-1)[0] || "(SubAgent 无文本结论)";
    }

    const idx = assistantParts.findIndex(
      (p) => p.type === "subagent" && p.id === subId,
    );
    if (idx >= 0) {
      assistantParts[idx] = {
        type: "subagent",
        id: subId,
        agent: kind,
        label: def.label,
        task,
        status: "done",
        summary,
        children: childParts,
      };
    }

    emit({
      type: "subagent_end",
      id: subId,
      agent: kind,
      label: def.label,
      ok: true,
      summary: summary.slice(0, 4000),
      children: childParts,
    });

    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      name: "run_subagent",
      content: JSON.stringify({
        ok: true,
        agent: kind,
        label: def.label,
        summary: summary.slice(0, 8000),
      }),
    });
    return;
  } catch (e) {
    ok = false;
    summary = String(e);
    const idx = assistantParts.findIndex(
      (p) => p.type === "subagent" && p.id === subId,
    );
    if (idx >= 0) {
      assistantParts[idx] = {
        type: "subagent",
        id: subId,
        agent: kind,
        label: def.label,
        task,
        status: "error",
        summary,
      };
    }
  }

  emit({
    type: "subagent_end",
    id: subId,
    agent: kind,
    label: def.label,
    ok,
    summary: summary.slice(0, 4000),
  });
  messages.push({
    role: "tool",
    tool_call_id: tc.id,
    name: "run_subagent",
    content: JSON.stringify({
      ok,
      agent: kind,
      label: def.label,
      summary: summary.slice(0, 8000),
    }),
  });
}
