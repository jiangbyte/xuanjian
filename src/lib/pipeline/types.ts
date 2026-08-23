/**
 * @file 多阶段 Pipeline 类型定义
 * @author Charlie
 */

/** 执行端点：本机 / WSL / SSH */
export type PipelineEndpoint =
  | { kind: "local" }
  | { kind: "wsl"; shell_id?: string; wsl_distro?: string }
  | { kind: "ssh"; host_id: number };

export type PipelineStageType = "exec" | "transfer" | "sync" | "batch";

export type PipelineStageBase = {
  id: string;
  name: string;
  type: PipelineStageType;
  /** 给 Agent 的阶段意图说明：要做什么、为何做、成功标准等 */
  prompt?: string;
  on_failure?: "stop" | "continue";
};

export type PipelineExecStage = PipelineStageBase & {
  type: "exec";
  endpoint: PipelineEndpoint;
  command?: string;
  script_id?: number;
};

export type PipelineTransferStage = PipelineStageBase & {
  type: "transfer";
  source: PipelineEndpoint;
  target: PipelineEndpoint;
  from_path: string;
  to_path: string;
  /** 大文件走 scp/cp 旁路，小文件走 FS 读写 */
  prefer_scp?: boolean;
};

export type PipelineSyncStage = PipelineStageBase & {
  type: "sync";
  workspace_id: number;
  dry_run?: boolean;
};

export type PipelineBatchStage = PipelineStageBase & {
  type: "batch";
  script_id: number;
  host_ids?: number[];
  host_group_id?: number;
};

export type PipelineStage =
  | PipelineExecStage
  | PipelineTransferStage
  | PipelineSyncStage
  | PipelineBatchStage;

export type PipelineDefinition = {
  version: 1;
  stages: PipelineStage[];
};

export type PipelineStageResult = {
  stage_id: string;
  stage_name: string;
  type: PipelineStageType;
  prompt?: string;
  ok: boolean;
  duration_ms: number;
  output?: string;
  error?: string;
  detail?: Record<string, unknown>;
};

export type PipelineRunResult = {
  pipeline_id: number;
  pipeline_name: string;
  dry_run: boolean;
  ok: boolean;
  stages: PipelineStageResult[];
};

/** @deprecated 使用 emptyPipelineDefinition */
export function defaultPipelineDefinition(): PipelineDefinition {
  return { version: 1, stages: [] };
}

export function parsePipelineDefinition(raw: string | null): PipelineDefinition {
  if (!raw?.trim()) return { version: 1, stages: [] };
  try {
    const parsed = JSON.parse(raw) as PipelineDefinition;
    if (parsed?.version === 1 && Array.isArray(parsed.stages)) return parsed;
  } catch {
    /* fallback */
  }
  return { version: 1, stages: [] };
}

export function endpointLabel(ep: PipelineEndpoint): string {
  if (ep.kind === "local") return "本机";
  if (ep.kind === "wsl") {
    const d = ep.shell_id?.replace(/^local:wsl:/, "") || ep.wsl_distro || "WSL";
    return `WSL (${d})`;
  }
  return `SSH #${ep.host_id}`;
}

/** 供 Agent 快速理解各阶段意图 */
export function summarizeStagesForAgent(
  stages: PipelineStage[],
): Array<{ index: number; name: string; type: PipelineStageType; prompt: string | null }> {
  return stages.map((s, i) => ({
    index: i + 1,
    name: s.name,
    type: s.type,
    prompt: s.prompt?.trim() || null,
  }));
}
