/**
 * @file 工具参数解析与 SubAgent 字段归一化
 * @author Charlie
 */

export function parseArgs(
  raw: string | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) return raw;
  try {
    const parsed = JSON.parse(raw || "{}");
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** 兼容模型偶发的参数别名 */
export function normalizeSubAgentArgs(args: Record<string, unknown>): {
  agent?: string;
  task?: string;
} {
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = args[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return undefined;
  };
  return {
    agent: pick([
      "agent",
      "Agent",
      "subagent",
      "sub_agent",
      "type",
      "kind",
    ]),
    task: pick([
      "task",
      "Task",
      "instruction",
      "prompt",
      "message",
      "goal",
      "description",
    ]),
  };
}
