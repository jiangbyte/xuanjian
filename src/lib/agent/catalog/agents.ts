/**
 * @file Catalog — 智能体层
 * @author Charlie
 */

import {
  RUN_SUBAGENT_TOOL,
  SUB_AGENTS,
  toolsForSubAgent,
} from "@/lib/agent/subagents";
import type { SubAgentKind } from "@/lib/agent/subagents/types";
import { READ_TOOL_NAMES, TOOL_DEFS } from "@/lib/agent/tools/defs";
import type { AgentToolDef } from "@/lib/agent/tools/types";

export type AgentCatalogEntry = {
  id: string;
  kind: "orchestrator" | "subagent";
  label: string;
  description: string;
  toolBindings: string[];
  readOnly: boolean;
};

export function listAgentCatalog(): AgentCatalogEntry[] {
  const orchestratorTools = [
    ...TOOL_DEFS.map((t) => t.function.name),
    RUN_SUBAGENT_TOOL.function.name,
  ];
  const entries: AgentCatalogEntry[] = [
    {
      id: "orchestrator",
      kind: "orchestrator",
      label: "编排器",
      description: "主 Agent：推理、工具调用、SubAgent 派发",
      toolBindings: [...new Set(orchestratorTools)],
      readOnly: true,
    },
  ];
  for (const kind of Object.keys(SUB_AGENTS) as SubAgentKind[]) {
    const def = SUB_AGENTS[kind];
    entries.push({
      id: kind,
      kind: "subagent",
      label: def.label,
      description: def.description,
      toolBindings: def.toolNames,
      readOnly: true,
    });
  }
  return entries;
}

export function resolveToolsForAgent(
  agentId: string,
  mode: "confirm" | "plan" | "full",
  allTools: AgentToolDef[],
): AgentToolDef[] {
  if (agentId === "orchestrator") {
    if (mode === "plan") {
      return allTools.filter((t) => READ_TOOL_NAMES.has(t.function.name));
    }
    return allTools;
  }
  if (agentId in SUB_AGENTS) {
    return toolsForSubAgent(agentId as SubAgentKind);
  }
  return allTools;
}
