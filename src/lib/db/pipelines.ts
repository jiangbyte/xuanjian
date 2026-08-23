/**
 * @file Pipeline 数据访问
 * @author Charlie
 */

import { getDb } from "@/lib/db/client";
import { emptyPipelineDefinition } from "@/lib/pipeline/stageDefaults";
import {
  parsePipelineDefinition,
  type PipelineDefinition,
} from "@/lib/pipeline/types";

export type PipelineRow = {
  id: number;
  name: string;
  description: string | null;
  definition_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type PipelineRunRow = {
  id: number;
  pipeline_id: number;
  dry_run: number;
  status: string;
  result_json: string | null;
  started_at: string;
  finished_at: string | null;
};

export type PipelineInput = {
  name: string;
  description?: string | null;
  definition?: PipelineDefinition;
  enabled?: boolean;
};

export async function listPipelines(): Promise<PipelineRow[]> {
  const db = await getDb();
  return db.select<PipelineRow[]>(
    "SELECT * FROM pipelines ORDER BY id DESC",
  );
}

export async function getPipeline(id: number): Promise<PipelineRow | null> {
  const db = await getDb();
  const rows = await db.select<PipelineRow[]>(
    "SELECT * FROM pipelines WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function createPipeline(input: PipelineInput): Promise<number> {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("pipeline name required");
  const def = input.definition ?? emptyPipelineDefinition();
  const result = await db.execute(
    `INSERT INTO pipelines (name, description, definition_json, enabled)
     VALUES ($1,$2,$3,$4)`,
    [
      name,
      input.description?.trim() || null,
      JSON.stringify(def),
      input.enabled === false ? 0 : 1,
    ],
  );
  return result.lastInsertId as number;
}

export async function updatePipeline(
  id: number,
  input: Partial<PipelineInput>,
): Promise<void> {
  const db = await getDb();
  const cur = await getPipeline(id);
  if (!cur) throw new Error("pipeline not found");
  const def =
    input.definition != null
      ? JSON.stringify(input.definition)
      : cur.definition_json;
  await db.execute(
    `UPDATE pipelines SET
      name=$1, description=$2, definition_json=$3, enabled=$4,
      updated_at=datetime('now')
     WHERE id=$5`,
    [
      (input.name ?? cur.name).trim(),
      input.description !== undefined
        ? input.description?.trim() || null
        : cur.description,
      def,
      input.enabled === false ? 0 : input.enabled === true ? 1 : cur.enabled,
      id,
    ],
  );
}

export async function deletePipeline(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM pipelines WHERE id = $1", [id]);
}

export function getPipelineDefinition(row: PipelineRow): PipelineDefinition {
  return parsePipelineDefinition(row.definition_json);
}

export async function listPipelineRuns(
  pipelineId?: number,
  limit = 30,
): Promise<PipelineRunRow[]> {
  const db = await getDb();
  if (pipelineId != null) {
    return db.select<PipelineRunRow[]>(
      "SELECT * FROM pipeline_runs WHERE pipeline_id = $1 ORDER BY id DESC LIMIT $2",
      [pipelineId, limit],
    );
  }
  return db.select<PipelineRunRow[]>(
    "SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT $1",
    [limit],
  );
}

export async function createPipelineRun(input: {
  pipeline_id: number;
  dry_run?: boolean;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO pipeline_runs (pipeline_id, dry_run, status)
     VALUES ($1,$2,'running')`,
    [input.pipeline_id, input.dry_run ? 1 : 0],
  );
  return result.lastInsertId as number;
}

export async function finishPipelineRun(
  id: number,
  status: string,
  result_json?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pipeline_runs SET status=$1, result_json=$2, finished_at=datetime('now')
     WHERE id=$3`,
    [status, result_json ?? null, id],
  );
}

/** 运行中写入阶段性结果，便于 UI / Agent 中途观测 */
export async function updatePipelineRunProgress(
  id: number,
  result_json: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE pipeline_runs SET result_json=$1 WHERE id=$2 AND status='running'",
    [result_json, id],
  );
}
