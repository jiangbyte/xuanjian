/**
 * @file Pipeline 阶段默认配置
 * @author Charlie
 */

import type { GroupRow, HostRow, ScriptRow } from "@/lib/db";
import type { WorkspaceRow } from "@/lib/db/workspaces";
import type {
  PipelineDefinition,
  PipelineEndpoint,
  PipelineStage,
  PipelineStageType,
} from "@/lib/pipeline/types";

export type PipelineResourceContext = {
  hosts: HostRow[];
  workspaces: WorkspaceRow[];
  scripts: ScriptRow[];
  groups: GroupRow[];
  wslDistros: string[];
};

export function emptyPipelineDefinition(): PipelineDefinition {
  return { version: 1, stages: [] };
}

function defaultWslEndpoint(ctx: PipelineResourceContext): PipelineEndpoint {
  const distro = ctx.wslDistros[0];
  if (distro) {
    return { kind: "wsl", wsl_distro: distro, shell_id: `local:wsl:${distro}` };
  }
  return { kind: "local" };
}

function defaultSshEndpoint(ctx: PipelineResourceContext): PipelineEndpoint {
  const host = ctx.hosts[0];
  if (host) return { kind: "ssh", host_id: host.id };
  return { kind: "local" };
}

/** 按当前环境资源生成新阶段默认值 */
export function makeNewStage(
  type: PipelineStageType,
  ctx: PipelineResourceContext,
): PipelineStage {
  const id = crypto.randomUUID();
  switch (type) {
    case "exec":
      return {
        id,
        name: "执行命令",
        type: "exec",
        endpoint: defaultWslEndpoint(ctx),
        command: "",
      };
    case "transfer":
      return {
        id,
        name: "文件传输",
        type: "transfer",
        source: defaultWslEndpoint(ctx),
        target: defaultSshEndpoint(ctx),
        from_path: "",
        to_path: "",
        prefer_scp: true,
      };
    case "sync":
      return {
        id,
        name: "同步代码",
        type: "sync",
        workspace_id: ctx.workspaces[0]?.id ?? 0,
      };
    case "batch":
      return {
        id,
        name: "批量执行",
        type: "batch",
        script_id: ctx.scripts[0]?.id ?? 0,
        host_group_id: ctx.groups[0]?.id,
      };
  }
}
