/**
 * @file Agent 工具注册表与分发
 * @author Charlie
 */

import { auditLog } from "@/lib/audit";
import {
  READ_TOOL_NAMES,
  TOOL_DEFS,
  WRITE_TOOL_NAMES,
} from "@/lib/agent/tools/defs";
import { runToolHandler } from "@/lib/agent/tools/handlers/core";
import { isDryRunAllowedInPlan } from "@/lib/agent/tools/handlers/deploy";
import { getScript } from "@/lib/db";
import { applyScriptVars, extractScriptVars } from "@/lib/session/scriptVars";
import {
  asNum,
  isDangerousCommand,
  type AgentToolDef,
  type ToolExecContext,
} from "@/lib/agent/tools/types";

export type { AgentToolDef, ToolExecContext } from "@/lib/agent/tools/types";
export { isDangerousCommand } from "@/lib/agent/tools/types";
export { READ_TOOL_NAMES as READ_TOOLS, WRITE_TOOL_NAMES as WRITE_TOOLS };

export const LOCAL_TOOLS: AgentToolDef[] = TOOL_DEFS;

let mergedMcpTools: AgentToolDef[] = [];

export function isWriteTool(name: string) {
  if (name.startsWith("mcp__")) return true;
  return WRITE_TOOL_NAMES.has(name);
}

/** 合并本地工具与已发现的 MCP 工具 */
export function getAllTools(
  permissionMode: ToolExecContext["permissionMode"] = "confirm",
): AgentToolDef[] {
  const base =
    permissionMode === "plan"
      ? LOCAL_TOOLS.filter((t) => READ_TOOL_NAMES.has(t.function.name))
      : LOCAL_TOOLS;
  return mergeToolDefs(base, mergedMcpTools);
}

/** 刷新 MCP 工具缓存（启动 Agent 前调用） */
export async function refreshAllTools(): Promise<AgentToolDef[]> {
  const { refreshMcpTools } = await import("@/lib/agent/mcp/client");
  mergedMcpTools = await refreshMcpTools();
  return getAllTools();
}

function resolveScriptVars(
  body: string,
  varsArg: unknown,
): { ok: true; body: string } | { ok: false } {
  const needed = extractScriptVars(body);
  const provided =
    varsArg && typeof varsArg === "object" && !Array.isArray(varsArg)
      ? (varsArg as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  for (const v of needed) {
    const raw = provided[v.name];
    if (raw != null && String(raw).length > 0) {
      values[v.name] = String(raw);
    } else if (v.defaultValue != null) {
      values[v.name] = v.defaultValue;
    } else {
      return { ok: false };
    }
  }
  return { ok: true, body: applyScriptVars(body, values) };
}

async function confirmIfNeeded(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<string | null> {
  const cmd =
    typeof args.command === "string" ? args.command.trim() : "";

  let scriptPreview: { name: string; body: string } | null = null;
  if (name === "run_script") {
    const scriptId = asNum(args.script_id);
    if (scriptId == null) return null;
    const script = await getScript(scriptId);
    if (!script) return null;
    const resolved = resolveScriptVars(script.body, args.vars);
    if (!resolved.ok) return null;
    scriptPreview = { name: script.name, body: resolved.body };
  }

  const dangerous =
    ((name === "terminal_run" || name === "session_exec") &&
      cmd.length > 0 &&
      isDangerousCommand(cmd)) ||
    (name === "run_script" &&
      !!scriptPreview &&
      isDangerousCommand(scriptPreview.body));

  const needsConfirm =
    (name === "terminal_run" ||
      name === "session_exec" ||
      name === "run_script" ||
      name === "run_batch" ||
      name === "docker_compose_up" ||
      name === "upload_file" ||
      name === "upload_tree" ||
      name === "write_remote_file" ||
      name === "deploy" ||
      (name === "sync_to_remote" && args.dry_run === false)) &&
    (ctx.permissionMode === "confirm" ||
      (ctx.permissionMode === "full" && dangerous));

  if (!needsConfirm) return null;

  const confirmArgs =
    name === "run_script" && scriptPreview
      ? {
          ...args,
          script_name: scriptPreview.name,
          resolved_preview: scriptPreview.body.slice(0, 500),
        }
      : args;
  const ok = ctx.confirmTool
    ? await ctx.confirmTool({ name, args: confirmArgs, dangerous })
    : false;
  if (!ok) {
    return JSON.stringify({
      ok: false,
      blocked: true,
      reason: "用户拒绝执行该操作",
    });
  }
  return null;
}

export async function executeLocalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<string> {
  if (name.startsWith("mcp__")) {
    if (ctx.permissionMode === "plan") {
      return JSON.stringify({
        ok: false,
        blocked: true,
        reason: "当前为「计划」模式：禁止执行 MCP 写操作。",
      });
    }
    if (ctx.permissionMode === "confirm") {
      const ok = ctx.confirmTool
        ? await ctx.confirmTool({ name, args, dangerous: false })
        : false;
      if (!ok) {
        return JSON.stringify({
          ok: false,
          blocked: true,
          reason: "用户拒绝执行该 MCP 工具",
        });
      }
    }
    const { callMcpTool } = await import("@/lib/agent/mcp/client");
    const result = await callMcpTool(name, args);
    void auditLog({
      action: "agent.tool_exec",
      target: name,
      detail: { args, source: "mcp" },
    });
    return result;
  }

  if (ctx.permissionMode === "plan" && isWriteTool(name)) {
    if (isDryRunAllowedInPlan(name, args)) {
      /* dry-run deploy/sync allowed in plan mode */
    } else {
      return JSON.stringify({
        ok: false,
        blocked: true,
        reason:
          "当前为「计划」模式：禁止执行写操作。请只使用只读工具，并在最终回复中给出分步计划。",
      });
    }
  }

  const blocked = await confirmIfNeeded(name, args, ctx);
  if (blocked) return blocked;

  const result = await runToolHandler(name, args);

  if (isWriteTool(name) && !result.includes('"blocked":true')) {
    void auditLog({
      action: "agent.tool_exec",
      target: name,
      detail: { args, permissionMode: ctx.permissionMode },
    });
  }

  return result;
}

/** 按名称合并额外工具（MCP 等动态注册） */
export function mergeToolDefs(
  base: AgentToolDef[],
  extra: AgentToolDef[],
): AgentToolDef[] {
  const names = new Set(base.map((t) => t.function.name));
  return [...base, ...extra.filter((t) => !names.has(t.function.name))];
}
