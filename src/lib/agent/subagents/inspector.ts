/**
 * @file 只读巡检 SubAgent
 * @author Charlie
 */

import type { SubAgentModule } from "@/lib/agent/subagents/types";

export const inspectorSubAgent: SubAgentModule = {
  def: {
    kind: "inspector",
    label: "只读巡检",
    description: "主机/会话/指标/文件/日志只读探测",
    toolNames: [
      "terminal_tail",
      "list_sessions",
      "host_info",
      "list_hosts",
      "host_metrics",
      "list_scripts",
      "get_script",
      "list_cmd_history",
      "list_files",
      "read_file",
      "file_info",
      "search_notes",
      "search_session_logs",
      "search_cmd_history",
      "port_snapshot",
      "disk_snapshot",
      "create_inspection_report",
    ],
    systemExtra:
      "你是只读巡检 SubAgent。只收集事实并简洁汇报，不执行破坏性命令。可查阅脚本库、历史命令、笔记与会话录制。host_metrics/port_snapshot/disk_snapshot 用于指标与资源探测；需要文件内容时用 list_files/read_file。",
    maxRounds: 5,
  },
};
