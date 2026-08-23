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
      "你是终端执行 SubAgent。仅在用户当前焦点终端标签执行；禁止跨标签、禁止自动新建 WSL/SSH 标签。WSL 任务须用户先切换到 WSL 标签。用 list_sessions 查看 active 标签与 plane。",
    maxRounds: 6,
  },
};
