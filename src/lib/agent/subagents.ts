/**
 * @file SubAgent 配置：规划编排 + 专职子代理
 * @author Charlie
 */

import type { AgentToolDef } from "@/lib/agent/tools";
import { LOCAL_TOOLS, READ_TOOLS } from "@/lib/agent/tools";

export type SubAgentKind = "terminal" | "inspector" | "analyst";

export type SubAgentDef = {
  kind: SubAgentKind;
  label: string;
  description: string;
  /** 允许的工具名；空数组表示仅推理不调工具 */
  toolNames: string[];
  systemExtra: string;
  maxRounds: number;
};

export const SUB_AGENTS: Record<SubAgentKind, SubAgentDef> = {
  terminal: {
    kind: "terminal",
    label: "终端执行",
    description: "在可见终端执行命令、读取输出",
    toolNames: [
      "terminal_run",
      "terminal_tail",
      "session_exec",
      "list_sessions",
      "list_scripts",
      "get_script",
      "list_cmd_history",
      "run_script",
    ],
    systemExtra:
      "你是终端执行 SubAgent。优先 terminal_run 让用户看见命令；库内已有合适脚本时用 list_scripts/get_script/run_script；可查 list_cmd_history 复用历史命令。不要编造输出；长命令先 tail 再决定是否继续等待。",
    maxRounds: 6,
  },
  inspector: {
    kind: "inspector",
    label: "只读巡检",
    description: "主机/会话/指标只读探测",
    toolNames: [
      "terminal_tail",
      "list_sessions",
      "host_info",
      "list_hosts",
      "host_metrics",
      "list_scripts",
      "get_script",
      "list_cmd_history",
    ],
    systemExtra:
      "你是只读巡检 SubAgent。只收集事实并简洁汇报，不执行破坏性命令。可查阅脚本库与历史命令作为参考，但不要 run_script。host_metrics 仅用于指标探测。",
    maxRounds: 5,
  },
  analyst: {
    kind: "analyst",
    label: "结果分析",
    description: "根据已有 Observation 做结论与建议（可再读终端尾部）",
    toolNames: [
      "terminal_tail",
      "list_sessions",
      "list_scripts",
      "get_script",
      "list_cmd_history",
    ],
    systemExtra:
      "你是分析 SubAgent。基于编排器提供的上下文与必要时再读的终端尾部、脚本库、历史命令，给出结论、风险与下一步建议，不要随意执行命令。",
    maxRounds: 3,
  },
};

export function toolsForSubAgent(kind: SubAgentKind): AgentToolDef[] {
  const names = new Set(SUB_AGENTS[kind].toolNames);
  return LOCAL_TOOLS.filter((t) => names.has(t.function.name));
}

export function toolsForOrchestrator(
  mode: "confirm" | "plan" | "full",
): AgentToolDef[] {
  const base =
    mode === "plan"
      ? LOCAL_TOOLS.filter((t) => READ_TOOLS.has(t.function.name))
      : LOCAL_TOOLS;
  return [...base, RUN_SUBAGENT_TOOL];
}

/** 编排器专用：派发 SubAgent */
export const RUN_SUBAGENT_TOOL: AgentToolDef = {
  type: "function",
  function: {
    name: "run_subagent",
    description:
      "派发专职 SubAgent 完成子任务。复杂运维请拆成多步：inspector 巡检 → terminal 执行 → analyst 总结。并行可连续多次调用。",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["terminal", "inspector", "analyst"],
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
  return v === "terminal" || v === "inspector" || v === "analyst";
}
