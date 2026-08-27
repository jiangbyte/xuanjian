/**
 * @file 每 Agent 作用域（工具/hook 子集）
 * @author Charlie
 */

import type { HookPoint } from "@/lib/agent/hooks/registry";
import { useHook } from "@/lib/agent/hooks/registry";
import type { AgentToolDef } from "@/lib/agent/tools";

export type AgentScope = {
  id: string;
  tools: AgentToolDef[];
  disposers: Array<() => void>;
};

export function createAgentScope(id: string, tools: AgentToolDef[]): AgentScope {
  return { id, tools, disposers: [] };
}

export function scopeUseHook<K extends HookPoint>(
  scope: AgentScope,
  point: K,
  fn: Parameters<typeof useHook<K>>[1],
): void {
  scope.disposers.push(useHook(point, fn));
}

export function disposeAgentScope(scope: AgentScope): void {
  for (const d of scope.disposers) d();
  scope.disposers = [];
}
