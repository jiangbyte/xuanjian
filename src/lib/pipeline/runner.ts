/**
 * @file Pipeline 执行引擎
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import { runBatchScript } from "@/lib/automation/batch";
import { getScript, getWorkspace } from "@/lib/db";
import {
  getPipeline,
  type PipelineRow,
  updatePipelineRunProgress,
} from "@/lib/db/pipelines";
import { resolvePipelineEndpoint } from "@/lib/pipeline/endpoints";
import { usePipelineRunStore } from "@/lib/pipeline/runStore";
import { pipelineTransferFile } from "@/lib/pipeline/transfer";
import {
  parsePipelineDefinition,
  type PipelineRunResult,
  type PipelineStage,
  type PipelineStageResult,
} from "@/lib/pipeline/types";
import { applyScriptVars, extractScriptVars } from "@/lib/session/scriptVars";
import { api, onSessionExecOutput } from "@/lib/tauri";
import {
  applySyncManifest,
  buildSyncManifest,
} from "@/lib/workspace/syncEngine";

export type PipelineRunOptions = {
  dryRun?: boolean;
  runId?: number | null;
  scriptVars?: Record<string, string>;
  source?: "ui" | "agent";
  streamLogs?: boolean;
  onStageStart?: (stage: PipelineStage, index: number) => void;
  onStageEnd?: (result: PipelineStageResult, index: number) => void;
  onStageLog?: (stageId: string, chunk: string) => void;
};

function stageResultBase(stage: PipelineStage) {
  const prompt = stage.prompt?.trim();
  return {
    stage_id: stage.id,
    stage_name: stage.name,
    type: stage.type,
    ...(prompt ? { prompt } : {}),
  };
}

async function execWithStream(
  sessionId: string,
  command: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const jobId = await api.sessionExecStream(sessionId, command);
  let buf = "";
  return new Promise((resolve, reject) => {
    let unlisten: (() => void) | undefined;
    void onSessionExecOutput((p) => {
      if (p.jobId !== jobId) return;
      if (p.done) {
        unlisten?.();
        resolve(buf);
        return;
      }
      if (!p.data) return;
      const chunk = stripAnsi(p.data);
      buf += chunk;
      onChunk?.(chunk);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(reject);
  });
}

function resolveCommand(
  stage: Extract<PipelineStage, { type: "exec" }>,
  scriptVars?: Record<string, string>,
): Promise<string> {
  return (async () => {
    let command = stage.command?.trim() ?? "";
    if (stage.script_id != null) {
      const script = await getScript(stage.script_id);
      if (!script) throw new Error(`Script #${stage.script_id} not found`);
      command = script.body;
      const vars = extractScriptVars(command);
      const values: Record<string, string> = { ...scriptVars };
      for (const v of vars) {
        if (values[v.name] == null && v.defaultValue != null) {
          values[v.name] = v.defaultValue;
        }
      }
      command = applyScriptVars(command, values);
    }
    if (!command) throw new Error("exec stage needs command or script_id");
    return command;
  })();
}

async function runExecStage(
  stage: Extract<PipelineStage, { type: "exec" }>,
  dryRun: boolean,
  opts: PipelineRunOptions,
): Promise<PipelineStageResult> {
  const t0 = Date.now();
  if (dryRun) {
    const preview = stage.command?.trim() || `script#${stage.script_id}`;
    return {
      ...stageResultBase(stage),
      ok: true,
      duration_ms: 0,
      output: `[dry-run] ${preview}`,
    };
  }
  const { sessionId } = await resolvePipelineEndpoint(stage.endpoint);
  const command = await resolveCommand(stage, opts.scriptVars);
  const onLog = (chunk: string) => opts.onStageLog?.(stage.id, chunk);

  const out =
    opts.streamLogs !== false
      ? await execWithStream(sessionId, command, onLog)
      : await api.sessionExec(sessionId, command);

  return {
    ...stageResultBase(stage),
    ok: true,
    duration_ms: Date.now() - t0,
    output: stripAnsi(out).slice(0, 20_000),
  };
}

async function runTransferStage(
  stage: Extract<PipelineStage, { type: "transfer" }>,
  dryRun: boolean,
  opts: PipelineRunOptions,
): Promise<PipelineStageResult> {
  const t0 = Date.now();
  if (dryRun) {
    return {
      ...stageResultBase(stage),
      ok: true,
      duration_ms: 0,
      output: `[dry-run] ${stage.from_path} → ${stage.to_path}`,
    };
  }
  opts.onStageLog?.(stage.id, `Transferring ${stage.from_path} → ${stage.to_path}…\n`);
  const detail = await pipelineTransferFile(
    stage.source,
    stage.target,
    stage.from_path,
    stage.to_path,
    { preferScp: stage.prefer_scp },
  );
  const msg = `Transferred via ${detail.method}`;
  opts.onStageLog?.(stage.id, `${msg}\n`);
  return {
    ...stageResultBase(stage),
    ok: true,
    duration_ms: Date.now() - t0,
    output: msg,
    detail,
  };
}

async function runSyncStage(
  stage: Extract<PipelineStage, { type: "sync" }>,
  dryRun: boolean,
  opts: PipelineRunOptions,
): Promise<PipelineStageResult> {
  const t0 = Date.now();
  const ws = await getWorkspace(stage.workspace_id);
  if (!ws) throw new Error(`Workspace #${stage.workspace_id} not found`);
  opts.onStageLog?.(stage.id, `Building sync manifest for ${ws.name}…\n`);
  const manifest = await buildSyncManifest(ws, { dryRun: dryRun || stage.dry_run });
  if (!dryRun && !stage.dry_run) {
    opts.onStageLog?.(stage.id, `Uploading ${manifest.uploadCount} file(s)…\n`);
    await applySyncManifest(ws, manifest);
  }
  const msg = `upload=${manifest.uploadCount} skip=${manifest.skipCount}`;
  opts.onStageLog?.(stage.id, `${msg}\n`);
  return {
    ...stageResultBase(stage),
    ok: true,
    duration_ms: Date.now() - t0,
    output: msg,
    detail: {
      uploadCount: manifest.uploadCount,
      skipCount: manifest.skipCount,
      dryRun: dryRun || Boolean(stage.dry_run),
    },
  };
}

async function runBatchStage(
  stage: Extract<PipelineStage, { type: "batch" }>,
  dryRun: boolean,
  opts: PipelineRunOptions,
): Promise<PipelineStageResult> {
  const t0 = Date.now();
  if (dryRun) {
    return {
      ...stageResultBase(stage),
      ok: true,
      duration_ms: 0,
      output: `[dry-run] script#${stage.script_id}`,
    };
  }
  opts.onStageLog?.(stage.id, `Running batch script #${stage.script_id}…\n`);
  const result = await runBatchScript({
    script_id: stage.script_id,
    host_ids: stage.host_ids,
    host_group_id: stage.host_group_id,
    vars: opts.scriptVars,
  });
  const text = JSON.stringify(result, null, 2).slice(0, 16_000);
  opts.onStageLog?.(stage.id, text);
  const failed = result.results.filter((r) => !r.ok).length;
  const ok = failed === 0;
  return {
    ...stageResultBase(stage),
    ok,
    duration_ms: Date.now() - t0,
    output: text,
    detail: {
      ok: result.results.filter((r) => r.ok).length,
      failed,
      total: result.results.length,
    },
  };
}

async function runStage(
  stage: PipelineStage,
  dryRun: boolean,
  opts: PipelineRunOptions,
): Promise<PipelineStageResult> {
  switch (stage.type) {
    case "exec":
      return runExecStage(stage, dryRun, opts);
    case "transfer":
      return runTransferStage(stage, dryRun, opts);
    case "sync":
      return runSyncStage(stage, dryRun, opts);
    case "batch":
      return runBatchStage(stage, dryRun, opts);
    default:
      throw new Error(`Unknown stage type`);
  }
}

function buildRunHooks(
  row: PipelineRow,
  opts: PipelineRunOptions,
  def: ReturnType<typeof parsePipelineDefinition>,
): PipelineRunOptions {
  const store = usePipelineRunStore.getState();
  const runId = opts.runId ?? null;

  return {
    ...opts,
    onStageStart: (stage, index) => {
      store.stageStart(index);
      const prompt = stage.prompt?.trim();
      if (prompt) {
        const line = `[意图] ${prompt}\n\n`;
        store.appendLog(stage.id, line);
        opts.onStageLog?.(stage.id, line);
      }
      opts.onStageStart?.(stage, index);
    },
    onStageEnd: (result, index) => {
      store.stageEnd(index, result);
      opts.onStageEnd?.(result, index);
      if (runId != null) {
        const live = usePipelineRunStore.getState().live;
        if (live) {
          void updatePipelineRunProgress(
            runId,
            JSON.stringify({
              pipeline_id: row.id,
              pipeline_name: row.name,
              dry_run: opts.dryRun ?? false,
              ok: false,
              stages: def.stages.slice(0, index + 1).map((s) => {
                const st = live.statuses[s.id];
                return {
                  stage_id: s.id,
                  stage_name: s.name,
                  type: s.type,
                  ok: st === "ok",
                  duration_ms: 0,
                  output: live.logs[s.id],
                };
              }),
            }),
          ).catch(console.error);
        }
      }
    },
    onStageLog: (stageId, chunk) => {
      store.appendLog(stageId, chunk);
      opts.onStageLog?.(stageId, chunk);
    },
  };
}

/** 执行整条 Pipeline */
export async function runPipeline(
  pipelineId: number,
  opts?: PipelineRunOptions,
): Promise<PipelineRunResult> {
  const row = await getPipeline(pipelineId);
  if (!row) throw new Error(`Pipeline #${pipelineId} not found`);
  return runPipelineDefinition(row, opts);
}

export async function runPipelineDefinition(
  row: PipelineRow,
  opts?: PipelineRunOptions,
): Promise<PipelineRunResult> {
  const def = parsePipelineDefinition(row.definition_json);
  const dryRun = opts?.dryRun ?? false;
  const store = usePipelineRunStore.getState();

  store.startRun({
    runId: opts?.runId ?? null,
    pipelineId: row.id,
    pipelineName: row.name,
    dryRun,
    stageIds: def.stages.map((s) => s.id),
    stageNames: def.stages.map((s) => s.name),
    source: opts?.source,
  });

  const hooks = buildRunHooks(row, opts ?? {}, def);
  const stages: PipelineStageResult[] = [];
  let allOk = true;

  for (let i = 0; i < def.stages.length; i++) {
    const stage = def.stages[i];
    hooks.onStageStart?.(stage, i);
    try {
      const result = await runStage(stage, dryRun, hooks);
      stages.push(result);
      hooks.onStageEnd?.(result, i);
      if (!result.ok && stage.on_failure !== "continue") {
        allOk = false;
        break;
      }
      if (!result.ok) allOk = false;
    } catch (e) {
      const fail: PipelineStageResult = {
        ...stageResultBase(stage),
        ok: false,
        duration_ms: 0,
        error: String(e),
      };
      stages.push(fail);
      hooks.onStageEnd?.(fail, i);
      hooks.onStageLog?.(stage.id, `Error: ${String(e)}\n`);
      allOk = false;
      if (stage.on_failure !== "continue") break;
    }
  }

  const result: PipelineRunResult = {
    pipeline_id: row.id,
    pipeline_name: row.name,
    dry_run: dryRun,
    ok: allOk,
    stages,
  };
  store.finishRun(result);
  return result;
}
