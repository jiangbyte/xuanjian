/**
 * @file 工具并发安全标记
 */

import { READ_TOOL_NAMES } from "@/lib/agent/tools/defs";

export function isConcurrencySafe(name: string): boolean {
  if (name === "run_subagent") return true;
  return READ_TOOL_NAMES.has(name);
}
