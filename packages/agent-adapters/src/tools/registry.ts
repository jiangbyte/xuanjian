/**
 * @file 工具定义按域拆分注册
 */

import type { CoreToolDef } from "@xuanjian/agent-core";
import {
  LOCAL_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
  getAllTools,
  isWriteTool,
} from "@/lib/agent/tools/registry";
import type { AgentToolDef } from "@/lib/agent/tools/types";

export type ToolDomain =
  | "terminal"
  | "read"
  | "network"
  | "docker"
  | "deploy"
  | "pipeline"
  | "script"
  | "other";

const DOMAIN_NAMES: Record<ToolDomain, string[]> = {
  terminal: [
    "terminal_run",
    "terminal_tail",
    "session_exec",
    "list_sessions",
  ],
  read: [
    "list_files",
    "read_file",
    "file_info",
    "host_info",
    "list_hosts",
    "host_metrics",
    "search_notes",
    "search_session_logs",
    "search_cmd_history",
    "port_snapshot",
    "disk_snapshot",
    "create_inspection_report",
  ],
  network: ["ping", "dns_lookup", "tcp_probe", "tls_cert"],
  docker: [
    "docker_ps",
    "docker_logs",
    "docker_inspect",
    "docker_compose_up",
  ],
  deploy: [
    "upload_file",
    "upload_tree",
    "sync_to_remote",
    "write_remote_file",
    "deploy",
  ],
  pipeline: ["list_pipelines", "get_pipeline", "run_pipeline"],
  script: [
    "list_scripts",
    "get_script",
    "run_script",
    "run_batch",
    "list_cmd_history",
  ],
  other: [],
};

export function domainOfTool(name: string): ToolDomain {
  for (const [domain, names] of Object.entries(DOMAIN_NAMES) as [
    ToolDomain,
    string[],
  ][]) {
    if (domain === "other") continue;
    if (names.includes(name)) return domain;
  }
  return "other";
}

export function toolsByDomain(
  permissionMode: "confirm" | "plan" | "full" = "confirm",
): Record<ToolDomain, AgentToolDef[]> {
  const all = getAllTools(permissionMode);
  const out: Record<ToolDomain, AgentToolDef[]> = {
    terminal: [],
    read: [],
    network: [],
    docker: [],
    deploy: [],
    pipeline: [],
    script: [],
    other: [],
  };
  for (const t of all) {
    out[domainOfTool(t.function.name)].push(t);
  }
  return out;
}

export function toCoreToolDefs(defs: AgentToolDef[]): CoreToolDef[] {
  return defs as unknown as CoreToolDef[];
}

/** 权限中间件：计划模式拦截写工具 */
export function withPlanModeGuard(
  execute: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>,
  permissionMode: "confirm" | "plan" | "full",
): typeof execute {
  return async (name, args) => {
    if (permissionMode === "plan" && isWriteTool(name)) {
      return JSON.stringify({
        ok: false,
        blocked: true,
        reason: "计划模式禁止写操作",
      });
    }
    return execute(name, args);
  };
}

export {
  LOCAL_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
  getAllTools,
  isWriteTool,
};
