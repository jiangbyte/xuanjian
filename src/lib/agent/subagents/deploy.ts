/**
 * @file 部署 SubAgent
 * @author Charlie
 */

import type { SubAgentModule } from "@/lib/agent/subagents/types";

export const deploySubAgent: SubAgentModule = {
  def: {
    kind: "deploy",
    label: "工作空间部署",
    description: "同步本地工作空间到远程并执行部署配方",
    toolNames: [
      "list_files",
      "read_file",
      "file_info",
      "sync_to_remote",
      "upload_file",
      "upload_tree",
      "write_remote_file",
      "deploy",
      "run_pipeline",
      "get_pipeline",
      "list_pipelines",
      "terminal_tail",
      "session_exec",
      "list_sessions",
    ],
    systemExtra:
      "你是部署 SubAgent。WSL 编译用 plane=wsl 或 shell_id，无需预先打开标签；远程部署用 plane=ssh + host_id 或 tab_id。数据库 dump 走 session_exec + scp，不用 workspace sync。",
    maxRounds: 5,
  },
};
