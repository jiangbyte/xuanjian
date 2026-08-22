/**
 * @file Agent 工具类型与常量
 * @author Charlie
 */

export type AgentToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolExecContext = {
  permissionMode: "confirm" | "plan" | "full";
  confirmTool?: (info: {
    name: string;
    args: Record<string, unknown>;
    dangerous: boolean;
  }) => Promise<boolean>;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecContext,
) => Promise<string>;

export const DANGEROUS_CMD_RE =
  /\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|passwd|userdel|DROP\s+TABLE|TRUNCATE)\b/i;

export function isDangerousCommand(cmd: string) {
  return DANGEROUS_CMD_RE.test(cmd);
}

export function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
