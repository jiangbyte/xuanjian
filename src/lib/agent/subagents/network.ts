/**
 * @file 网络探测 SubAgent
 * @author Charlie
 */

import type { SubAgentModule } from "@/lib/agent/subagents/types";

export const networkSubAgent: SubAgentModule = {
  def: {
    kind: "network",
    label: "网络探测",
    description: "Ping/DNS/TCP/TLS 只读连通性探测",
    toolNames: ["ping", "dns_lookup", "tcp_probe", "tls_cert"],
    systemExtra:
      "你是网络探测 SubAgent。使用 ping、dns_lookup、tcp_probe、tls_cert 收集连通性与证书事实，不做终端写操作。汇报时注明目标、结果与延迟/错误信息。",
    maxRounds: 4,
  },
};
