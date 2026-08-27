/**
 * @file 本地 ReAct 入口（薄封装，委托 agent-loop driver）
 * @author Charlie
 */

import { appendAgentMessage } from "@/lib/db";
import { runReActLoop } from "@/lib/agent/agent-loop/driver";
import { resolveProvider } from "@/lib/agent/agent-loop/provider";
import { buildOrchestratorSystemWithContext } from "@/lib/agent/system-prompt/assemble";
import { toolsForOrchestrator } from "@/lib/agent/subagents";
import { buildExecutionContextBlockIfChanged } from "@/lib/agent/executionContext";
import { getSessionInbox } from "@/lib/agent/runtime/inbox";
import type { RunAgentInput, RuntimeEvent } from "@/lib/agent/types";
import { ReactLoopGuard, REACT_LIMITS } from "@/lib/agent/reactGuards";
import { SessionStore } from "@/lib/agent/session";
import { emitActivity } from "@/lib/agent/llm/stream";

const ORCH_MAX_ROUNDS = REACT_LIMITS.ORCH_MAX_ROUNDS;

/**
 * 本地编排入口：Orchestrator ReAct + 可派发 SubAgent。
 */
export async function runLocalReAct(input: RunAgentInput): Promise<void> {
  const provider = await resolveProvider(input.modelRef);
  const { refreshAllTools } = await import("@/lib/agent/tools");
  await refreshAllTools();
  const emit = (e: RuntimeEvent) => input.onEvent(e);
  emitActivity(emit, "planning", "处理中…");

  const inbox = getSessionInbox(input.sessionId);
  const ctxBlock = await buildExecutionContextBlockIfChanged();
  if (ctxBlock) inbox.inject(ctxBlock);

  const parts = await runReActLoop({
    input,
    provider,
    system: await buildOrchestratorSystemWithContext(input.permissionMode),
    tools: toolsForOrchestrator(input.permissionMode),
    userText: input.userText,
    history: input.history,
    maxRounds: ORCH_MAX_ROUNDS,
    agentTag: "orchestrator",
    agentLabel: "编排器",
    persist: true,
    depth: 0,
    guard: new ReactLoopGuard(REACT_LIMITS.ORCH_MAX_TOOL_CALLS),
    session: new SessionStore(),
    inbox,
  });

  await appendAgentMessage({
    session_id: input.sessionId,
    role: "assistant",
    parts: parts.length ? parts : [{ type: "text", text: "(无回复)" }],
  });
  emitActivity(emit, "idle", "空闲");
  emit({ type: "done" });
}
