/**
 * @file 终端执行 SubAgent
 * @author Charlie
 */

import type { SubAgentModule } from "@/lib/agent/subagents/types";

export const terminalSubAgent: SubAgentModule = {
  def: {
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
      "run_batch",
    ],
    systemExtra:
      "你是终端执行 SubAgent。多标签时用 list_sessions 获取 tab_id，session_exec/terminal_run 传 tab_id 指定 WSL 或 SSH。WSL（plane=local-wsl）是本机 Linux，不是 SSH 远程。优先 terminal_run 让用户看见命令；库内已有合适脚本时用 run_script。不要编造输出。",
    maxRounds: 6,
  },
};
