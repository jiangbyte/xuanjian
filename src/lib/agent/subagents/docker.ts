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
    toolNames: [
      "docker_ps",
      "docker_logs",
      "docker_inspect",
      "docker_compose_up",
    ],
    systemExtra:
      "你是 Docker SubAgent。仅在当前焦点标签执行 Docker 命令；WSL Docker 须用户先打开 WSL 终端标签，远程须先打开 SSH 标签。禁止自动新建或切换标签。",
    maxRounds: 4,
  },
};
