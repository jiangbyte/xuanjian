/**
 * @file 收集 Pipeline 运行前需填写的脚本变量
 * @author Charlie
 */

import { getScript } from "@/lib/db";
import type { PipelineDefinition } from "@/lib/pipeline/types";
import { extractScriptVars, type ScriptVar } from "@/lib/session/scriptVars";

export type PipelineVarField = ScriptVar & {
  stageName: string;
};

/** 从定义中收集所有 exec/batch 脚本变量（去重） */
export async function collectPipelineVars(
  definition: PipelineDefinition,
): Promise<PipelineVarField[]> {
  const seen = new Set<string>();
  const fields: PipelineVarField[] = [];

  for (const stage of definition.stages) {
    let body = "";
    if (stage.type === "exec" && stage.script_id != null) {
      const script = await getScript(stage.script_id);
      body = script?.body ?? "";
    } else if (stage.type === "batch") {
      const script = await getScript(stage.script_id);
      body = script?.body ?? "";
    }
    if (!body) continue;
    for (const v of extractScriptVars(body)) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      fields.push({ ...v, stageName: stage.name });
    }
  }
  return fields;
}
