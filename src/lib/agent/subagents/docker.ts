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
      "你是 Docker SubAgent。WSL Docker 用 plane=wsl 或 shell_id（无需预先打开标签）；远程用 plane=ssh + host_id。docker_ps/logs/inspect/compose_up 均可自动连接。",
    maxRounds: 4,
  },
};
