/**
 * @file Agent 运行时共享类型
 * @author Charlie
 */

import type { ThinkingMode } from "@/lib/agent/contextBudget";
import { getSetting, type AgentPermissionMode } from "@/lib/db";

/** 侧栏活动条阶段：让用户感知是否仍在执行 */
export type AgentActivityPhase =
  | "idle"
  | "planning"
  | "calling_model"
  | "thinking"
  | "awaiting_confirm"
  | "running_tool"
  | "subagent"
  | "summarizing";

export type RuntimeEvent =
  | { type: "thinking"; text: string; agent?: string }
  | { type: "text"; text: string; agent?: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
      agent?: string;
    }
  | {
      type: "tool_pending";
      id: string;
      name: string;
      args: unknown;
      dangerous?: boolean;
      agent?: string;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      result: string;
      agent?: string;
    }
  | { type: "plan"; items: string[]; agent?: string }
  | { type: "status"; text: string }
  | {
      type: "activity";
      phase: AgentActivityPhase;
      label: string;
      detail?: string;
    }
  | {
      type: "subagent_start";
      id: string;
      agent: string;
      label: string;
      task: string;
    }
  | {
      type: "subagent_end";
      id: string;
      agent: string;
      label: string;
      ok: boolean;
      summary: string;
      children?: import("@/lib/db").MessagePart[];
    }
  | { type: "error"; text: string }
  | { type: "done" };

export type ConfirmToolRequest = {
  id: string;
  name: string;
  args: unknown;
  dangerous?: boolean;
};

export type RunAgentInput = {
  sessionId: number;
  userText: string;
  runtime: "local" | "remote";
  remoteAgentId?: string | null;
  modelRef?: string | null;
  permissionMode: AgentPermissionMode;
  thinkingMode?: ThinkingMode;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  onEvent: (e: RuntimeEvent) => void;
  onConfirmTool?: (req: ConfirmToolRequest) => Promise<boolean>;
  /** 取消当前轮次 */
  signal?: AbortSignal;
};

export async function getBackendBase(): Promise<{
  baseUrl: string;
  token: string;
}> {
  const baseUrl = (await getSetting("backend.base_url")) ?? "";
  const token = (await getSetting("backend.token")) ?? "";
  return { baseUrl: baseUrl.trim(), token: token.trim() };
}
