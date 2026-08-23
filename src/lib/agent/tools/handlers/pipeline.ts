/**
 * @file Agent Pipeline 工具处理器
 * @author Charlie
 */

import {
  createPipelineRun,
  finishPipelineRun,
  getPipeline,
  getPipelineDefinition,
  listPipelines,
} from "@/lib/db/pipelines";
import { runPipeline } from "@/lib/pipeline/runner";
import { summarizeStagesForAgent } from "@/lib/pipeline/types";
import { asNum } from "@/lib/agent/tools/types";

export async function runPipelineToolHandler(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  switch (name) {
    case "list_pipelines": {
      const rows = await listPipelines();
      return JSON.stringify(
        rows.map((r) => {
          const def = getPipelineDefinition(r);
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            enabled: Boolean(r.enabled),
            stage_count: def.stages.length,
            stages_summary: summarizeStagesForAgent(def.stages),
          };
        }),
        null,
        2,
      );
    }
    case "get_pipeline": {
      const id = asNum(args.pipeline_id);
      if (id == null) {
        return JSON.stringify({ ok: false, error: "pipeline_id required" });
      }
      const row = await getPipeline(id);
      if (!row) {
        return JSON.stringify({ ok: false, error: "pipeline not found" });
      }
      const definition = getPipelineDefinition(row);
      return JSON.stringify(
        {
          id: row.id,
          name: row.name,
          description: row.description,
          definition,
          stages_summary: summarizeStagesForAgent(definition.stages),
          agent_note:
            "各阶段 prompt 字段描述该步意图与成功标准；执行前请先阅读 stages_summary。",
        },
        null,
        2,
      );
    }
    case "run_pipeline": {
      const id = asNum(args.pipeline_id);
      if (id == null) {
        return JSON.stringify({ ok: false, error: "pipeline_id required" });
      }
      const dryRun = args.dry_run === true;
      const row = await getPipeline(id);
      const definition = row ? getPipelineDefinition(row) : null;
      const runId = await createPipelineRun({ pipeline_id: id, dry_run: dryRun });
      try {
        const result = await runPipeline(id, {
          dryRun,
          runId,
          source: "agent",
          streamLogs: true,
        });
        await finishPipelineRun(
          runId,
          result.ok ? "ok" : "error",
          JSON.stringify(result),
        );
        return JSON.stringify(
          {
            run_id: runId,
            hint: "用户可在「流水线」页面查看完整运行日志与阶段进度。",
            stages_summary: definition
              ? summarizeStagesForAgent(definition.stages)
              : [],
            ...result,
          },
          null,
          2,
        );
      } catch (e) {
        await finishPipelineRun(runId, "error", JSON.stringify({ error: String(e) }));
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    default:
      return null;
  }
}
