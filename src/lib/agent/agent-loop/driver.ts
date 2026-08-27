/**
 * @file turn/step ReAct 循环驱动
 * @author Charlie
 */

import type { MessagePart } from "@/lib/db";
import type { LlmMessage } from "@/lib/agent/llm";
import type { NormalizedLlmReply } from "@/lib/agent/llm";
import type { LlmUsage } from "@/lib/agent/contextBudget";
import { parseContextWindow } from "@/lib/agent/contextBudget";
import { measureSurfaceTokens } from "@/lib/agent/contextBudget/meter";
import {
  runPreRequestHooks,
  runPreStepHooks,
  registerDefaultToolHooks,
} from "@/lib/agent/hooks";
import {
  registerCompactionHook,
  setCompactionRuntime,
  compactOnOverflow,
  compactLlmMessagesForModel,
  sanitizeLlmMessagesForApi,
} from "@/lib/agent/compaction";
import { isContextOverflowError } from "@/lib/agent/compaction/pressure";
import { AgentInbox, type LoopOpts } from "@/lib/agent/agent-loop/types";
import {
  finishGracefully,
  splitPlanFromReply,
} from "@/lib/agent/agent-loop/graceful-stop";
import { runToolCallsBatch } from "@/lib/agent/agent-loop/tool-calls";
import { emitActivity, requestModelReply } from "@/lib/agent/llm/stream";
import { REACT_LIMITS } from "@/lib/agent/reactGuards";
import { SessionStore } from "@/lib/agent/session";
import type { RuntimeEvent } from "@/lib/agent/types";
import {
  registerAgentWallClockHooks,
  setBlockingUi,
} from "@/lib/ui/blockingUi";

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
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

let hooksBooted = false;

function ensureHooks(provider: LoopOpts["provider"], opts: LoopOpts): void {
  if (!hooksBooted) {
    registerDefaultToolHooks();
    registerCompactionHook();
    hooksBooted = true;
  }
  setCompactionRuntime({
    provider,
    system: opts.system,
    tools: opts.tools,
    signal: opts.input.signal,
    lastUsage: opts.lastUsage,
    sampledSurfaceTokens: opts.sampledSurfaceTokens,
    inTurnParts: opts.inTurnParts,
    onStatus: (text) => opts.input.onEvent({ type: "status", text }),
  });
}

export async function runReActLoop(opts: LoopOpts): Promise<MessagePart[]> {
  const { input, provider, guard } = opts;
  const emit = (e: RuntimeEvent) => opts.input.onEvent(e);
  const session = opts.session ?? new SessionStore();
  const inbox = opts.inbox ?? new AgentInbox();

  let lastUsage: LlmUsage | null = opts.lastUsage ?? null;
  let sampledSurfaceTokens: number | null = opts.sampledSurfaceTokens ?? null;
  const contextLimit = parseContextWindow(provider.contextTag);

  const measureCurrentSurface = (msgs: LlmMessage[]) =>
    measureSurfaceTokens({
      system: opts.system,
      tools: opts.tools,
      messages: msgs.filter((m) => m.role !== "system"),
    });

  registerAgentWallClockHooks(
    () => guard.pauseWallClock(),
    () => guard.resumeWallClock(),
  );

  const assistantParts: MessagePart[] = [];
  let messages: LlmMessage[] = [
    { role: "system", content: opts.system },
    ...opts.history,
    { role: "user", content: opts.userText },
  ];

  session.startTurn();
  session.append("user/message", { content: opts.userText });

  let rounds = 0;
  let emptyRounds = 0;
  let finished = false;
  let progressBonus = 0;
  let forceTextOnlyNext = false;
  let overflowRetries = 0;
  const roundCap = () => opts.maxRounds + progressBonus;

  const syncCompactionRuntime = () => {
    ensureHooks(provider, {
      ...opts,
      lastUsage,
      sampledSurfaceTokens,
      inTurnParts: assistantParts,
    });
  };

  syncCompactionRuntime();

  while (rounds < roundCap()) {
    checkAbort(input.signal);

    const wallHit = guard.checkWallClock();
    if (wallHit) break;

    if (inbox.hasPending && rounds >= opts.maxRounds - 1) {
      progressBonus = Math.max(progressBonus, REACT_LIMITS.PROGRESS_BONUS_ROUNDS);
    }

    for (const injected of inbox.drainInject()) {
      messages.push({ role: "user", content: injected });
      session.append("user/message", { content: injected });
    }

    const steerMsg = inbox.claim("next-step");
    if (steerMsg) {
      messages.push({ role: "user", content: steerMsg });
      session.append("user/message", { content: steerMsg });
    }

    session.startStep();
    rounds += 1;
    syncCompactionRuntime();

    const preStep = await runPreStepHooks({
      turn: session.getEvents().filter((e) => e.type === "turn/start").length,
      step: rounds,
      messages,
    });

    if (preStep.kind === "reject") {
      emit({ type: "error", text: preStep.reason });
      assistantParts.push({ type: "text", text: preStep.reason });
      break;
    }
    if (preStep.kind === "inject") {
      messages = preStep.messages;
      const lastCompaction = preStep.messages.find(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("<compacted-summary>"),
      );
      if (lastCompaction && typeof lastCompaction.content === "string") {
        const summary = lastCompaction.content
          .replace(/<compacted-summary>\n?/, "")
          .replace(/\n?<\/compacted-summary>/, "");
        assistantParts.push({ type: "compaction", summary });
        session.append("compaction", { summary });
      }
    }

    emitActivity(
      emit,
      "calling_model",
      (input.thinkingMode ?? "high") === "off" ? "处理中…" : "思考中…",
    );

    const truncateOpts = {
      contextLimit,
      lastUsage,
      system: opts.system,
      tools: opts.tools,
    };

    const preReq = await runPreRequestHooks({
      messages: sanitizeLlmMessagesForApi(
        compactLlmMessagesForModel(messages, truncateOpts),
      ),
      tools: forceTextOnlyNext ? [] : opts.tools,
    });

    let reply: NormalizedLlmReply;
    const thinkingEnabled = (input.thinkingMode ?? "high") !== "off";

    try {
      reply = await requestModelReply(
        provider,
        preReq.messages,
        preReq.tools,
        {
          thinkingMode: input.thinkingMode ?? "high",
          signal: input.signal,
          stream: true,
          callbacks: {
            onTextDelta: (d) => {
              emit({
                type: "text_delta",
                text: d,
                agent: opts.agentTag,
              });
            },
            onThinkingDelta: (d) => {
              emit({
                type: "thinking_delta",
                text: d,
                agent: opts.agentTag,
              });
            },
            onUsage: (u) => {
              lastUsage = u;
              sampledSurfaceTokens = measureCurrentSurface(preReq.messages);
              syncCompactionRuntime();
            },
          },
        },
      );
    } catch (e) {
      if (isContextOverflowError(e) && overflowRetries < 2) {
        overflowRetries += 1;
        const compacted = await compactOnOverflow(messages);
        if (compacted) {
          messages = compacted;
          session.endStep();
          rounds -= 1;
          continue;
        }
      }
      const msg = userFacingError(e);
      emit({ type: "error", text: msg });
      assistantParts.push({ type: "text", text: msg });
      session.endStep();
      break;
    }

    if (reply.usage) {
      lastUsage = reply.usage;
      sampledSurfaceTokens = measureCurrentSurface(preReq.messages);
      syncCompactionRuntime();
      emit({
        type: "usage",
        usage: reply.usage,
        agent: opts.agentTag,
      });
    }

    checkAbort(input.signal);
    forceTextOnlyNext = false;
    session.endStep();

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

    const thinking = thinkingEnabled ? reply.thinking.trim() : "";
    if (thinking) {
      emitActivity(emit, "thinking", "思考中…");
      assistantParts.push({
        type: "thinking",
        text: thinking,
        agent: opts.agentTag,
      });
      session.append("assistant/chunk", {
        kind: "thinking",
        text: thinking,
        agent: opts.agentTag,
      });
    }

    session.append("assistant/message", {
      text: reply.text || undefined,
      thinking: thinking || undefined,
      toolCalls: reply.toolCalls.length ? reply.toolCalls : undefined,
      anthropicContent: reply.anthropicContent,
      agent: opts.agentTag,
    });

    if (!reply.toolCalls.length) {
      const text = reply.text.trim();
      if (text) {
        const planSplit =
          input.permissionMode === "plan" && opts.depth === 0
            ? splitPlanFromReply(text)
            : null;
        const displayText = planSplit?.body ?? text;
        assistantParts.push({
          type: "text",
          text: displayText,
          agent: opts.agentTag,
        });
        session.append("assistant/chunk", {
          kind: "text",
          text: displayText,
          agent: opts.agentTag,
        });
        if (planSplit?.planItems?.length) {
          assistantParts.push({ type: "plan", items: planSplit.planItems });
          emit({ type: "plan", items: planSplit.planItems });
        }
      } else if (!thinking) {
        const fallback = "(无回复)";
        assistantParts.push({ type: "text", text: fallback });
        emit({ type: "text", text: fallback, agent: opts.agentTag });
      }
      finished = true;
      break;
    }

    if (reply.text.trim()) {
      const t = reply.text.trim();
      assistantParts.push({
        type: "text",
        text: t,
        agent: opts.agentTag,
      });
      session.append("assistant/chunk", {
        kind: "text",
        text: t,
        agent: opts.agentTag,
      });
    }

    messages.push({
      role: "assistant",
      content: reply.text || null,
      tool_calls: reply.toolCalls,
      anthropic_content: reply.anthropicContent,
    });

    const batchResult = await runToolCallsBatch(
      reply.toolCalls,
      { ...opts, session },
      assistantParts,
      messages,
      emit,
    );

    if (batchResult === "wrap_up" || batchResult === "stop") {
      messages.push({
        role: "user",
        content:
          "（系统）请根据目前所有执行结果，用中文向用户说明进展、是否完成、以及若未完成时的下一步建议。不要再调用工具。",
      });
      forceTextOnlyNext = true;
      if (batchResult === "wrap_up") continue;
      break;
    }

    if (
      reply.toolCalls.length > 0 &&
      rounds >= opts.maxRounds - 3 &&
      progressBonus < REACT_LIMITS.PROGRESS_BONUS_ROUNDS
    ) {
      progressBonus = REACT_LIMITS.PROGRESS_BONUS_ROUNDS;
    }
  }

  if (!finished) {
    if (!guard.lastStopReason && inbox.hasPending) {
      inbox.steer("请继续完成未结束的步骤，并给出阶段性结论。");
    }
    if (!guard.lastStopReason) {
      guard.markWrapUp("max_rounds");
    }
    await finishGracefully(opts, provider, assistantParts, emit);
  }

  session.endTurn(finished ? "completed" : guard.lastStopReason ?? "stopped");

  registerAgentWallClockHooks(() => {}, () => {});
  setBlockingUi(false);

  return assistantParts;
}

export { AgentInbox };
