/**
 * @file 工具执行（pre/post hooks）
 * @author Charlie
 */

import { runPostExecuteHooks, runPreExecuteHooks } from "@/lib/agent/hooks";
import { runToolHandler } from "@/lib/agent/tools/handlers/core";
import type { ToolExecContext } from "@/lib/agent/tools/types";

async function executeToolCore(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name.startsWith("mcp__")) {
    const { callMcpTool } = await import("@/lib/agent/mcp/client");
    return callMcpTool(name, args);
  }
  return runToolHandler(name, args);
}

/** 经 hook 执行工具（权限 / 审计） */
export async function executeToolWithHooks(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<string> {
  const pre = await runPreExecuteHooks({ name, args, execCtx: ctx });
  if (pre.kind === "deny") return pre.result;

  const raw = await executeToolCore(name, args);
  return runPostExecuteHooks({ name, args, result: raw, execCtx: ctx }, raw);
}
