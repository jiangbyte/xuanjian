/**
 * @file 内置 MCP 工具清单（与 Agent tools 对齐，供设置页展示）
 * @author Charlie
 */

import { LOCAL_TOOLS } from "@/lib/agent/tools";

export const BUILTIN_MCP_SERVER = {
  id: "xuanjian-local",
  name: "xuanjian-local",
  description: "本地终端 / 主机 / SubAgent 编排工具",
  scope: "local" as const,
  tools: [
    ...LOCAL_TOOLS.map((t) => t.function.name),
    "run_subagent",
  ],
};
