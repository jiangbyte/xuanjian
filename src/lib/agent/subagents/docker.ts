/**
 * @file Docker 只读 SubAgent
 * @author Charlie
 */

import type { SubAgentModule } from "@/lib/agent/subagents/types";

export const dockerSubAgent: SubAgentModule = {
  def: {
    kind: "docker",
    label: "Docker 只读",
    description: "容器列表、日志与 inspect 只读查询",
    toolNames: ["docker_ps", "docker_logs", "docker_inspect", "docker_compose_up"],
    systemExtra:
      "你是 Docker SubAgent。用 list_sessions 取 tab_id：WSL 内 Docker 用 plane=local-wsl 的标签，远程用 plane=remote-ssh。docker_ps/logs/inspect 与 compose_up 均需传 tab_id。不执行 start/stop/rm 等写操作（compose_up 除外）。",
    maxRounds: 4,
  },
};
