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
import { buildOrchestratorSystemWithContext, buildSubAgentSystemWithContext } from "@/lib/agent/prompts";
import {
  executeLocalTool,
  isWriteTool,
  refreshAllTools,
  type AgentToolDef,
} from "@/lib/agent/tools";
import type {
  AgentActivityPhase,
  RunAgentInput,
  RuntimeEvent,
} from "@/lib/agent/types";
import {
  ReactLoopGuard,
  REACT_LIMITS,
  type GuardStopReason,
} from "@/lib/agent/reactGuards";
import {
  registerAgentWallClockHooks,
  setBlockingUi,
} from "@/lib/ui/blockingUi";
import type { NormalizedLlmReply } from "@/lib/agent/llm";

const ORCH_MAX_ROUNDS = REACT_LIMITS.ORCH_MAX_ROUNDS;

/** 压缩历史 tool Observation，避免长任务上下文膨胀导致模型中断 */
function compactLlmMessagesForModel(messages: LlmMessage[]): LlmMessage[] {
  const TOOL_KEEP_FULL = 8;
  const OLD_TOOL_MAX = 3500;
  const RECENT_TOOL_MAX = 10_000;

  const toolIdxs: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool") toolIdxs.push(i);
  });
  const keepFullFrom = Math.max(0, toolIdxs.length - TOOL_KEEP_FULL);

  return messages.map((m, i) => {
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    const pos = toolIdxs.indexOf(i);
    const max = pos >= keepFullFrom ? RECENT_TOOL_MAX : OLD_TOOL_MAX;
    if (m.content.length <= max) return m;
    return {
      ...m,
      content: `${m.content.slice(0, max)}\n…(已截断，共 ${m.content.length} 字符)`,
    };
  });
}

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
  guard: ReactLoopGuard;
};

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
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

function shouldPauseWallClockForTool(
  name: string,
  args: Record<string, unknown>,
): boolean {
  const wait =
    typeof args.wait_ms === "number" ? Math.max(args.wait_ms, 0) : 0;
  if ((name === "terminal_tail" || name === "terminal_run") && wait > 2000) {
    return true;
  }
  if (name === "run_script" && wait > 2000) return true;
  if (name === "session_exec") return true;
  if (name === "sync_to_remote" && args.dry_run === false) return true;
  if (name === "upload_file" || name === "upload_tree") return true;
  if (name === "deploy" && args.dry_run !== true) return true;
  return false;
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
  await refreshAllTools();
  const emit = (e: RuntimeEvent) => input.onEvent(e);
  emitActivity(emit, "planning", "处理中…");

  const parts = await runReActLoop({
    input,
    provider,
    system: await buildOrchestratorSystemWithContext(input.permissionMode),
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
    guard: new ReactLoopGuard(REACT_LIMITS.ORCH_MAX_TOOL_CALLS),
  });

  await appendAgentMessage({
    session_id: input.sessionId,
    role: "assistant",
    parts: parts.length ? parts : [{ type: "text", text: "(无回复)" }],
  });
  emitActivity(emit, "idle", "空闲");
  emit({ type: "done" });
}

function isEmptyReply(reply: NormalizedLlmReply): boolean {
  return (
    !reply.thinking.trim() &&
    !reply.text.trim() &&
    reply.toolCalls.length === 0
  );
}

function userFacingError(e: unknown): string {
  const msg = String(e);
  if (msg.includes("超时")) {
    return "这次响应时间较长，已中断。你可以重试，或把问题拆小一点。";
  }
  return msg;
}

function hasUserFacingText(parts: MessagePart[]): boolean {
  return parts.some(
    (p) =>
      p.type === "text" &&
      p.text.trim() &&
      p.text !== "(无回复)",
  );
}

function buildObservationsForSummary(parts: MessagePart[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.type === "tool_result") {
      chunks.push(`[${p.name}] ${p.result.slice(0, 800)}`);
    } else if (p.type === "subagent" && p.summary) {
      chunks.push(`[${p.label}] ${p.summary.slice(0, 1500)}`);
    }
  }
  return chunks.join("\n").slice(0, 8000);
}

/** 护栏触发或步数用尽：静默收尾，只给用户自然语言结论 */
async function finishGracefully(
  opts: LoopOpts,
  provider: ProviderBundle,
  assistantParts: MessagePart[],
  emit: (e: RuntimeEvent) => void,
): Promise<void> {
  const guardStop = opts.guard.lastStopReason;
  if (hasUserFacingText(assistantParts) && !guardStop) return;

  const summary = await tryEarlyStopSummary(
    opts,
    provider,
    assistantParts,
    guardStop,
  );
  if (summary) {
    assistantParts.push({
      type: "text",
      text: summary,
      agent: opts.agentTag,
    });
    emit({ type: "text", text: summary, agent: opts.agentTag });
    return;
  }

  const fromSub = assistantParts
    .filter(
      (p): p is Extract<MessagePart, { type: "subagent" }> =>
        p.type === "subagent",
    )
    .map((p) => p.summary?.trim())
    .filter(Boolean)
    .join("\n\n");
  if (fromSub) {
    assistantParts.push({
      type: "text",
      text: fromSub,
      agent: opts.agentTag,
    });
    emit({ type: "text", text: fromSub, agent: opts.agentTag });
    return;
  }

  const fallback =
    "根据目前掌握的信息，我还无法给出完整结论。你可以补充一下目标环境，或告诉我希望优先排查哪一块。";
  assistantParts.push({ type: "text", text: fallback, agent: opts.agentTag });
  emit({ type: "text", text: fallback, agent: opts.agentTag });
}

/** 步数用尽时尝试无工具收尾 */
async function tryEarlyStopSummary(
  opts: LoopOpts,
  provider: ProviderBundle,
  assistantParts: MessagePart[],
  guardStop: GuardStopReason | null = null,
): Promise<string | null> {
  const observations = buildObservationsForSummary(assistantParts);
  if (!observations.trim()) return null;

  const incompleteHint = guardStop
    ? "\n\n注意：任务可能尚未完全结束。请明确说明已完成与未完成的部分，并建议用户回复「继续」以接着执行。"
    : "";

  try {
    emitActivity((e) => opts.input.onEvent(e), "summarizing", "整理回复…");
    const reply = await chatCompletion(
      {
        baseUrl: provider.provider.base_url,
        apiFormat: provider.provider.api_format,
        apiKey: provider.apiKey,
        model: provider.modelId,
        thinkingMode: "off",
        maxTokens: provider.maxTokens,
        signal: opts.input.signal,
      },
      [
        {
          role: "system",
          content:
            "你是运维助手。根据已有执行结果，用自然、专业的中文直接回答用户。不要提及步数、循环、工具上限或任何内部机制。若信息不完整，说明已确认的内容，并简要建议下一步。",
        },
        {
          role: "user",
          content: `用户问题：${opts.userText}\n\n已收集的信息：\n${observations}${incompleteHint}\n\n请直接回答用户。`,
        },
      ],
      [],
    );
    const text = reply.text.trim() || reply.thinking.trim();
    return text || null;
  } catch {
    return null;
  }
}

async function runReActLoop(opts: LoopOpts): Promise<MessagePart[]> {
  const { input, provider, guard } = opts;
  const emit = (e: RuntimeEvent) => opts.input.onEvent(e);
  registerAgentWallClockHooks(
    () => guard.pauseWallClock(),
    () => guard.resumeWallClock(),
  );
  const assistantParts: MessagePart[] = [];
  const messages: LlmMessage[] = [
    { role: "system", content: opts.system },
    ...opts.history,
    { role: "user", content: opts.userText },
  ];

  let rounds = 0;
  let emptyRounds = 0;
  let finished = false;
  let progressBonus = 0;
  let forceTextOnlyNext = false;
  const roundCap = () => opts.maxRounds + progressBonus;

  while (rounds < roundCap()) {
    checkAbort(input.signal);

    const wallHit = guard.checkWallClock();
    if (wallHit) break;

    rounds += 1;
    emitActivity(
      emit,
      "calling_model",
      (input.thinkingMode ?? "high") === "off" ? "处理中…" : "思考中…",
    );

    let reply: NormalizedLlmReply;
    try {
      reply = await chatCompletion(
        {
          baseUrl: provider.provider.base_url,
          apiFormat: provider.provider.api_format,
          apiKey: provider.apiKey,
          model: provider.modelId,
          thinkingMode: input.thinkingMode ?? "high",
          maxTokens: provider.maxTokens,
          signal: input.signal,
        },
        compactLlmMessagesForModel(messages),
        forceTextOnlyNext ? [] : opts.tools,
      );
    } catch (e) {
      const msg = userFacingError(e);
      emit({ type: "error", text: msg });
      assistantParts.push({ type: "text", text: msg });
      break;
    }

    if (reply.usage) {
      emit({
        type: "usage",
        usage: reply.usage,
        agent: opts.agentTag,
      });
    }

    checkAbort(input.signal);
    forceTextOnlyNext = false;

    if (isEmptyReply(reply)) {
      emptyRounds += 1;
      if (emptyRounds >= REACT_LIMITS.MAX_EMPTY_ROUNDS) {
        guard.markWrapUp("empty_replies");
        break;
      }
      messages.push({ role: "assistant", content: "(空回复)" });
      messages.push({
        role: "user",
        content:
          "（系统）你上一轮没有有效输出。请直接回答用户，或调用工具并说明原因；不要留空。",
      });
      continue;
    }
    emptyRounds = 0;

    const thinkingEnabled = (input.thinkingMode ?? "high") !== "off";
    let thinking = thinkingEnabled ? reply.thinking.trim() : "";
    if (
      thinkingEnabled &&
      !thinking &&
      reply.toolCalls.length &&
      reply.text.trim()
    ) {
      thinking = reply.text.trim();
    }
    if (thinking) {
      emitActivity(emit, "thinking", "思考中…");
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
        const fallback = "(无回复)";
        assistantParts.push({ type: "text", text: fallback });
        emit({ type: "text", text: fallback, agent: opts.agentTag });
      }
      finished = true;
      break;
    }

    if (
      reply.text.trim() &&
      !(thinking && reply.text.trim() === thinking)
    ) {
      const t = reply.text.trim();
      assistantParts.push({
        type: "text",
        text: t,
        agent: opts.agentTag,
      });
      emit({ type: "text", text: t, agent: opts.agentTag });
    }

    messages.push({
      role: "assistant",
      content: reply.text || null,
      tool_calls: reply.toolCalls,
      anthropic_content: reply.anthropicContent,
    });

    let wrapUpAfterTools = false;
    for (const tc of reply.toolCalls) {
      checkAbort(input.signal);
      const blocked = await runOneAction(
        tc,
        opts,
        assistantParts,
        messages,
        emit,
      );
      if (blocked === "wrap_up") {
        wrapUpAfterTools = true;
        break;
      }
      if (blocked === "stop") {
        wrapUpAfterTools = true;
        break;
      }
    }

    if (
      reply.toolCalls.length > 0 &&
      rounds >= opts.maxRounds - 3 &&
      progressBonus < REACT_LIMITS.PROGRESS_BONUS_ROUNDS
    ) {
      progressBonus = REACT_LIMITS.PROGRESS_BONUS_ROUNDS;
    }

    if (wrapUpAfterTools) {
      messages.push({
        role: "user",
        content:
          "（系统）请根据目前所有执行结果，用中文向用户说明进展、是否完成、以及若未完成时的下一步建议。不要再调用工具。",
      });
      forceTextOnlyNext = true;
      continue;
    }
  }

  if (!finished) {
    if (!guard.lastStopReason) {
      guard.markWrapUp("max_rounds");
    }
    await finishGracefully(opts, provider, assistantParts, emit);
  }

  registerAgentWallClockHooks(() => {}, () => {});
  setBlockingUi(false);

  return assistantParts;
}

async function runOneAction(
  tc: LlmToolCall,
  opts: LoopOpts,
  assistantParts: MessagePart[],
  messages: LlmMessage[],
  emit: (e: RuntimeEvent) => void,
): Promise<"ok" | "stop" | "wrap_up"> {
  const args = parseArgs(tc.function.arguments);
  const name = tc.function.name;
  const { input } = opts;

  const guardBlock = opts.guard.beforeToolCall(name, args);
  if (guardBlock) {
    pushResult(
      assistantParts,
      messages,
      emit,
      tc,
      name,
      guardBlock,
      opts.agentTag,
    );
    if (opts.guard.shouldWrapUp) return "wrap_up";
    return "ok";
  }

  if (name === "run_subagent") {
    const stop = await runSubAgentAction(
      tc,
      args,
      opts,
      assistantParts,
      messages,
      emit,
    );
    return stop ? "wrap_up" : "ok";
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
    return "ok";
  }

  emitActivity(
    emit,
    "running_tool",
    "执行中…",
    typeof args.command === "string" ? String(args.command) : undefined,
  );

  const pauseWall = shouldPauseWallClockForTool(name, args);
  if (pauseWall) opts.guard.pauseWallClock();
  let resultRaw: string;
  try {
    resultRaw = await executeLocalTool(name, args, {
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
    }).catch(
      (e) =>
        JSON.stringify({
          ok: false,
          error: String(e),
          hint: "工具执行异常；请根据错误调整参数或先修复环境后继续后续步骤。",
        }),
    );
  } finally {
    if (pauseWall) opts.guard.resumeWallClock();
  }

  emitActivity(
    emit,
    "calling_model",
    (input.thinkingMode ?? "high") === "off" ? "处理中…" : "思考中…",
  );

  const result = stripAnsi(resultRaw);
  pushResult(assistantParts, messages, emit, tc, name, result, opts.agentTag);
  return "ok";
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
): Promise<boolean> {
  const kindRaw = args.agent;
  const task = String(args.task ?? "").trim();
  if (!isSubAgentKind(kindRaw) || !task) {
    const result = JSON.stringify({
      ok: false,
      error: "run_subagent 需要 agent(terminal|inspector|analyst|network|docker|deploy) 与 task",
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
    return false;
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
    return false;
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
    return false;
  }

  const subId = tc.id;
  emit({
    type: "subagent_start",
    id: subId,
    agent: kind,
    label: def.label,
    task,
  });
  emitActivity(emit, "subagent", def.label, task.slice(0, 80));

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
      system: await buildSubAgentSystemWithContext(
        def.systemExtra,
        `父任务上下文由编排器下达。你的任务：${task}`,
        opts.input.permissionMode === "confirm"
          ? "写操作需用户确认。"
          : opts.input.permissionMode === "full"
            ? "可执行写操作；危险命令仍确认。"
            : "只读。",
      ),
      tools: toolsForSubAgent(kind),
      userText: task,
      history: [],
      maxRounds: def.maxRounds,
      agentTag: kind,
      agentLabel: def.label,
      persist: false,
      depth: opts.depth + 1,
      guard: new ReactLoopGuard(Math.max(def.maxRounds * 8, 120)),
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
    return false;
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
  return false;
}
