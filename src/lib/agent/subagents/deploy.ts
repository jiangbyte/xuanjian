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
      "terminal_tail",
      "session_exec",
      "list_sessions",
    ],
    systemExtra:
      "你是部署 SubAgent。编译在 WSL（tab_id + plane=local-wsl），部署在 SSH（tab_id + plane=remote-ssh）。先 sync_to_remote(dry_run=true) 生成变更清单。数据库 dump 不要用 workspace sync，用 session_exec + scp。路径必须在工作空间根内。",
    maxRounds: 5,
  },
};
