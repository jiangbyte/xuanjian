/**
 * @file SubAgent 类型定义
 * @author Charlie
 */

import type { AgentToolDef } from "@/lib/agent/tools";

export type SubAgentKind =
  | "terminal"
  | "inspector"
  | "analyst"
  | "network"
  | "docker"
  | "deploy";

export type SubAgentDef = {
  kind: SubAgentKind;
  label: string;
  description: string;
  toolNames: string[];
  systemExtra: string;
  maxRounds: number;
};

export type SubAgentModule = {
  def: SubAgentDef;
  extraTools?: AgentToolDef[];
};
