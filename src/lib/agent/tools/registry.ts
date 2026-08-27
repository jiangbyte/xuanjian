/**
 * @file Agent 工具注册表与分发
 * @author Charlie
 */

import {
  READ_TOOL_NAMES,
  TOOL_DEFS,
  WRITE_TOOL_NAMES,
} from "@/lib/agent/tools/defs";
import type { AgentToolDef, ToolExecContext } from "@/lib/agent/tools/types";
import { executeToolWithHooks } from "@/lib/agent/tools/execute";

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

/** 经 hook 管线执行工具（权限/审计由默认 hooks 处理） */
export async function executeLocalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<string> {
  return executeToolWithHooks(name, args, ctx);
}

/** 按名称合并额外工具（MCP 等动态注册） */
export function mergeToolDefs(
  base: AgentToolDef[],
  extra: AgentToolDef[],
): AgentToolDef[] {
  const names = new Set(base.map((t) => t.function.name));
  return [...base, ...extra.filter((t) => !names.has(t.function.name))];
}
