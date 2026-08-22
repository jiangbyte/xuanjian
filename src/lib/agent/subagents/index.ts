/**
 * @file SubAgent 注册表与编排工具
 * @author Charlie
 */

import type { AgentToolDef } from "@/lib/agent/tools";
import { getAllTools, LOCAL_TOOLS } from "@/lib/agent/tools";
import { analystSubAgent } from "@/lib/agent/subagents/analyst";
import { deploySubAgent } from "@/lib/agent/subagents/deploy";
import { dockerSubAgent } from "@/lib/agent/subagents/docker";
import { inspectorSubAgent } from "@/lib/agent/subagents/inspector";
import { networkSubAgent } from "@/lib/agent/subagents/network";
import { terminalSubAgent } from "@/lib/agent/subagents/terminal";
import type { SubAgentDef, SubAgentKind } from "@/lib/agent/subagents/types";

export type { SubAgentDef, SubAgentKind } from "@/lib/agent/subagents/types";

const MODULES = [
  terminalSubAgent,
  inspectorSubAgent,
  analystSubAgent,
  networkSubAgent,
  dockerSubAgent,
  deploySubAgent,
];

export const SUB_AGENTS: Record<SubAgentKind, SubAgentDef> = Object.fromEntries(
  MODULES.map((m) => [m.def.kind, m.def]),
) as Record<SubAgentKind, SubAgentDef>;

const SUB_AGENT_KINDS: SubAgentKind[] = MODULES.map((m) => m.def.kind);

export function toolsForSubAgent(kind: SubAgentKind): AgentToolDef[] {
  const names = new Set(SUB_AGENTS[kind].toolNames);
  return LOCAL_TOOLS.filter((t: AgentToolDef) => names.has(t.function.name));
}

export function toolsForOrchestrator(
  mode: "confirm" | "plan" | "full",
): AgentToolDef[] {
  return [...getAllTools(mode), RUN_SUBAGENT_TOOL];
}

/** 编排器专用：派发 SubAgent */
export const RUN_SUBAGENT_TOOL: AgentToolDef = {
  type: "function",
  function: {
    name: "run_subagent",
    description:
      "派发专职 SubAgent 完成子任务。复杂运维请拆成多步：inspector 巡检 → network/docker 专项 → terminal 执行 → deploy 部署 → analyst 总结。并行可连续多次调用。",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: SUB_AGENT_KINDS,
          description: "SubAgent 类型",
        },
        task: {
          type: "string",
          description: "交给该 SubAgent 的明确任务说明（含必要上下文）",
        },
      },
      required: ["agent", "task"],
    },
  },
};

export function isSubAgentKind(v: unknown): v is SubAgentKind {
  return (
    v === "terminal" ||
    v === "inspector" ||
    v === "analyst" ||
    v === "network" ||
    v === "docker" ||
    v === "deploy"
  );
}
