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
      "你是终端执行 SubAgent。WSL 标签不必预先打开：传 shell_id（如 local:wsl:Ubuntu）或 plane=wsl 即可自动连接。多标签时用 list_sessions 查 openTabs / availableShells。WSL（plane=local-wsl）是本机 Linux，不是 SSH。",
    maxRounds: 6,
  },
};
