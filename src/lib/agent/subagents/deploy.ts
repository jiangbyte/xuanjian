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
      "你是部署 SubAgent。仅在当前焦点终端标签执行命令；WSL 编译须用户先切换到 WSL 标签，远程部署须先打开 SSH 标签。禁止跨标签、禁止自动新建标签。数据库 dump 走 session_exec + scp，不用 workspace sync。多步任务须连续执行：dry_run 预览后必须继续实际 sync/deploy 并验证；远程目录不存在时 sync 会自动 mkdir -p。批量文件同步优先 sync_to_remote(dry_run=false)，不要用 read_file+write_remote_file 逐文件搬运。docker compose/pull 等长任务：terminal_run 或 terminal_tail 一次设足够 wait_ms（如 120000）；若返回 still_running=true，按 suggested_next_wait_ms 加大等待，禁止无进展短轮询；若出现 registry-1.docker.io i/o timeout，配置镜像加速或手动 docker pull 后重试。",
    maxRounds: 48,
  },
};
