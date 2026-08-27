/**
 * @file 工具与 SubAgent 执行
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import type { LoopOpts } from "@/lib/agent/agent-loop/types";
import { buildSubAgentSystemWithContext } from "@/lib/agent/prompts";
import { ReactLoopGuard } from "@/lib/agent/reactGuards";
import {
  isSubAgentKind,
  SUB_AGENTS,
  toolsForSubAgent,
  type SubAgentKind,
} from "@/lib/agent/subagents";
import { isWriteTool } from "@/lib/agent/tools";
import { executeToolViaPipeline } from "@/lib/agent/tools/pipeline";
import type { LlmMessage, LlmToolCall } from "@/lib/agent/llm";
import type { MessagePart } from "@/lib/db";
import type { RuntimeEvent } from "@/lib/agent/types";
import { emitActivity } from "@/lib/agent/llm/stream";
import { isConcurrencySafe } from "@/lib/agent/agent-loop/concurrency";
import {
  normalizeSubAgentArgs,
  parseArgs,
} from "@/lib/agent/agent-loop/parse-tool-args";

export { parseArgs, normalizeSubAgentArgs } from "@/lib/agent/agent-loop/parse-tool-args";

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

export function pushResult(
  assistantParts: MessagePart[],
  messages: LlmMessage[],
  emit: (e: RuntimeEvent) => void,
  tc: LlmToolCall,
  name: string,
  result: string,
  agent: string,
  session?: LoopOpts["session"],
) {
  assistantParts.push({
    type: "tool_result",
    id: tc.id,
    name,
    result,
    agent,
  });
  emit({ type: "tool_result", id: tc.id, name, result, agent });
  session?.append("tool/result", { id: tc.id, name, result, agent });
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
  const normalized = normalizeSubAgentArgs(args);
  const kindRaw = normalized.agent;
  const task = normalized.task ?? "";
  if (!isSubAgentKind(kindRaw) || !task) {
    const result = JSON.stringify({
      ok: false,
      error:
        "run_subagent 需要 agent(terminal|inspector|analyst|network|docker|deploy) 与 task",
    });
    pushResult(
      assistantParts,
      messages,
      emit,
      tc,
      "run_subagent",
      result,
      opts.agentTag,
      opts.session,
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
      opts.session,
    );
    return false;
  }

  const kind = kindRaw as SubAgentKind;
  const def = SUB_AGENTS[kind];

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
      opts.session,
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
  opts.session?.append("subagent/start", {
    id: subId,
    agent: kind,
    label: def.label,
    task,
  });

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
    const { runReActLoop } = await import("@/lib/agent/agent-loop/driver");
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
    opts.session?.append("subagent/end", {
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
  opts.session?.append("subagent/end", {
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

export async function runOneAction(
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
      opts.session,
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

  const thinkingBefore = assistantParts
    .filter(
      (p): p is Extract<MessagePart, { type: "thinking" }> =>
        p.type === "thinking" && p.agent === opts.agentTag,
    )
    .map((p) => p.text)
    .join("\n")
    .trim();

  assistantParts.push({
    type: "tool_call",
    id: tc.id,
    name,
    args,
    agent: opts.agentTag,
    thinkingBefore: thinkingBefore || undefined,
  });
  emit({
    type: "tool_call",
    id: tc.id,
    name,
    args,
    agent: opts.agentTag,
  });
  opts.session?.append("tool/call", { id: tc.id, name, args, agent: opts.agentTag });

  if (input.permissionMode === "plan" && isWriteTool(name)) {
    const result = JSON.stringify({
      ok: false,
      blocked: true,
      reason: "计划模式禁止写操作",
    });
    pushResult(
      assistantParts,
      messages,
      emit,
      tc,
      name,
      result,
      opts.agentTag,
      opts.session,
    );
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
    resultRaw = await executeToolViaPipeline(name, args, {
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
  pushResult(
    assistantParts,
    messages,
    emit,
    tc,
    name,
    result,
    opts.agentTag,
    opts.session,
  );
  return "ok";
}

/** 并行调度同一批可并发的 tool calls */
export async function runToolCallsBatch(
  toolCalls: LlmToolCall[],
  opts: LoopOpts,
  assistantParts: MessagePart[],
  messages: LlmMessage[],
  emit: (e: RuntimeEvent) => void,
): Promise<"ok" | "stop" | "wrap_up"> {
  const parallelSafe = toolCalls.filter((tc) =>
    isConcurrencySafe(tc.function.name),
  );
  const sequential = toolCalls.filter(
    (tc) => !isConcurrencySafe(tc.function.name),
  );

  if (parallelSafe.length > 1) {
    const results = await Promise.all(
      parallelSafe.map((tc) =>
        runOneAction(tc, opts, assistantParts, messages, emit),
      ),
    );
    if (results.includes("wrap_up")) return "wrap_up";
    if (results.includes("stop")) return "stop";
  } else if (parallelSafe.length === 1) {
    const r = await runOneAction(
      parallelSafe[0],
      opts,
      assistantParts,
      messages,
      emit,
    );
    if (r !== "ok") return r;
  }

  for (const tc of sequential) {
    const r = await runOneAction(tc, opts, assistantParts, messages, emit);
    if (r !== "ok") return r;
  }
  return "ok";
}
