/**
 * @file Catalog — 工具层元数据
 * @author Charlie
 */

import { TOOL_DEFS } from "@/lib/agent/tools/defs";
import type { AgentToolDef } from "@/lib/agent/tools/types";

export type ToolDomain =
  | "terminal"
  | "files"
  | "network"
  | "docker"
  | "deploy"
  | "scripts"
  | "inspection"
  | "other";

export type CatalogToolMeta = {
  name: string;
  description: string;
  domain: ToolDomain;
  pluginId: string;
  readOnly: boolean;
  write: boolean;
};

const DOMAIN_BY_PREFIX: Array<[RegExp, ToolDomain]> = [
  [/^terminal_|^session_/, "terminal"],
  [/^list_files|^read_file|^file_info|^write_remote|^upload_/, "files"],
  [/^ping$|^dns_|^tcp_|^tls_/, "network"],
  [/^docker_/, "docker"],
  [/^sync_|^deploy$|^upload_/, "deploy"],
  [/^list_scripts|^get_script|^run_script|^run_batch/, "scripts"],
  [/^create_inspection|^search_/, "inspection"],
];

function inferDomain(name: string): ToolDomain {
  for (const [re, domain] of DOMAIN_BY_PREFIX) {
    if (re.test(name)) return domain;
  }
  return "other";
}

const WRITE_TOOLS = new Set(
  TOOL_DEFS.filter((t) => {
    const n = t.function.name;
    return (
      !n.startsWith("list_") &&
      !n.startsWith("get_") &&
      !n.startsWith("search_") &&
      ![
        "host_info",
        "host_metrics",
        "port_snapshot",
        "disk_snapshot",
        "ping",
        "dns_lookup",
        "tcp_probe",
        "tls_cert",
        "docker_ps",
        "docker_logs",
        "docker_inspect",
        "terminal_tail",
        "file_info",
        "read_file",
        "list_files",
        "list_sessions",
        "list_hosts",
        "list_cmd_history",
        "create_inspection_report",
      ].includes(n)
    );
  }).map((t) => t.function.name),
);

export function catalogBuiltinTools(): CatalogToolMeta[] {
  return TOOL_DEFS.map((t) => {
    const name = t.function.name;
    return {
      name,
      description: t.function.description ?? name,
      domain: inferDomain(name),
      pluginId: "xuanjian-local",
      readOnly: true,
      write: WRITE_TOOLS.has(name),
    };
  });
}

export function catalogMcpTool(
  serverId: number,
  _serverName: string,
  def: AgentToolDef,
): CatalogToolMeta {
  const name = def.function.name;
  return {
    name,
    description: def.function.description ?? name,
    domain: "other",
    pluginId: `mcp:${serverId}`,
    readOnly: false,
    write: true,
  };
}

export const TOOL_DOMAINS: ToolDomain[] = [
  "terminal",
  "files",
  "network",
  "docker",
  "deploy",
  "scripts",
  "inspection",
  "other",
];

export function domainLabel(domain: ToolDomain): string {
  const labels: Record<ToolDomain, string> = {
    terminal: "终端",
    files: "文件",
    network: "网络",
    docker: "Docker",
    deploy: "部署",
    scripts: "脚本",
    inspection: "巡检",
    other: "其他",
  };
  return labels[domain];
}
