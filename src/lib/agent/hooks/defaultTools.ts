/**
 * @file 默认工具权限与审计 hooks
 * @author Charlie
 */

import { auditLog } from "@/lib/audit";
import { useHook } from "@/lib/agent/hooks/registry";
import { getScript } from "@/lib/db";
import { isDryRunAllowedInPlan } from "@/lib/agent/tools/handlers/deploy";
import {
  asNum,
  isDangerousCommand,
  type ToolExecContext,
} from "@/lib/agent/tools/types";
import { isWriteTool } from "@/lib/agent/tools/registry";
import { applyScriptVars, extractScriptVars } from "@/lib/session/scriptVars";

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

async function needsConfirm(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<{ needs: boolean; dangerous: boolean; confirmArgs: Record<string, unknown> }> {
  const cmd = typeof args.command === "string" ? args.command.trim() : "";

  let scriptPreview: { name: string; body: string } | null = null;
  if (name === "run_script") {
    const scriptId = asNum(args.script_id);
    if (scriptId != null) {
      const script = await getScript(scriptId);
      if (script) {
        const resolved = resolveScriptVars(script.body, args.vars);
        if (resolved.ok) {
          scriptPreview = { name: script.name, body: resolved.body };
        }
      }
    }
  }

  const dangerous =
    ((name === "terminal_run" || name === "session_exec") &&
      cmd.length > 0 &&
      isDangerousCommand(cmd)) ||
    (name === "run_script" &&
      !!scriptPreview &&
      isDangerousCommand(scriptPreview.body));

  const needs =
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

  const confirmArgs =
    name === "run_script" && scriptPreview
      ? {
          ...args,
          script_name: scriptPreview.name,
          resolved_preview: scriptPreview.body.slice(0, 500),
        }
      : args;

  return { needs, dangerous, confirmArgs };
}

let registered = false;

/** 注册默认工具权限与审计 hooks（幂等） */
export function registerDefaultToolHooks(): void {
  if (registered) return;
  registered = true;

  useHook("tools/pre-execute", async (ctx, next) => {
    const { name, args, execCtx } = ctx;

    if (name.startsWith("mcp__")) {
      if (execCtx.permissionMode === "plan") {
        return {
          kind: "deny",
          result: JSON.stringify({
            ok: false,
            blocked: true,
            reason: "当前为「计划」模式：禁止执行 MCP 写操作。",
          }),
        };
      }
      if (execCtx.permissionMode === "confirm") {
        const ok = execCtx.confirmTool
          ? await execCtx.confirmTool({ name, args, dangerous: false })
          : false;
        if (!ok) {
          return {
            kind: "deny",
            result: JSON.stringify({
              ok: false,
              blocked: true,
              reason: "用户拒绝执行该 MCP 工具",
            }),
          };
        }
      }
      return next();
    }

    if (execCtx.permissionMode === "plan" && isWriteTool(name)) {
      if (!isDryRunAllowedInPlan(name, args)) {
        return {
          kind: "deny",
          result: JSON.stringify({
            ok: false,
            blocked: true,
            reason:
              "当前为「计划」模式：禁止执行写操作。请只使用只读工具，并在最终回复中给出分步计划。",
          }),
        };
      }
    }

    const confirm = await needsConfirm(name, args, execCtx);
    if (confirm.needs) {
      const ok = execCtx.confirmTool
        ? await execCtx.confirmTool({
            name,
            args: confirm.confirmArgs,
            dangerous: confirm.dangerous,
          })
        : false;
      if (!ok) {
        return {
          kind: "deny",
          result: JSON.stringify({
            ok: false,
            blocked: true,
            reason: "用户拒绝执行该操作",
          }),
        };
      }
    }

    return next();
  });

  useHook("tools/post-execute", async (ctx, next) => {
    const result = await next();
    if (
      isWriteTool(ctx.name) &&
      !ctx.name.startsWith("mcp__") &&
      !result.includes('"blocked":true')
    ) {
      void auditLog({
        action: "agent.tool_exec",
        target: ctx.name,
        detail: { args: ctx.args, permissionMode: ctx.execCtx.permissionMode },
      });
    }
    if (ctx.name.startsWith("mcp__") && !result.includes('"blocked":true')) {
      void auditLog({
        action: "agent.tool_exec",
        target: ctx.name,
        detail: { args: ctx.args, source: "mcp" },
      });
    }
    return result;
  });
}

/** 测试用重置 */
export function resetDefaultToolHooks(): void {
  registered = false;
}
