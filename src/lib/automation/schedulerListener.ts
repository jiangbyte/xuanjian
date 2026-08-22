/**
 * @file 定时任务事件监听
 * @author Charlie
 * @description 接收 Rust 调度器 emit 的 scheduler-job-due，执行脚本批量任务。
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { runBatchScript } from "@/lib/automation/batch";
import {
  createJobRun,
  finishJobRun,
  type ScheduledJobRow,
} from "@/lib/db/automation";

type SchedulerJobEvent = {
  jobId: number;
  name: string;
  jobType: string;
  scriptId?: number | null;
  hostGroupId?: number | null;
  hostIdsJson?: string | null;
  cronExpr: string;
};

function parseHostIds(raw?: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is number => typeof x === "number");
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function executeScheduledJob(ev: SchedulerJobEvent) {
  if (ev.jobType !== "script" || ev.scriptId == null) {
    toast.message(`Scheduled job: ${ev.name}`, {
      description: `Type ${ev.jobType} (no auto handler)`,
    });
    return;
  }

  const runId = await createJobRun({
    job_id: ev.jobId,
    job_type: ev.jobType,
    status: "running",
  });

  try {
    const result = await runBatchScript({
      script_id: ev.scriptId,
      host_ids: parseHostIds(ev.hostIdsJson),
      host_group_id: ev.hostGroupId ?? null,
    });
    await finishJobRun(runId, "ok", JSON.stringify(result));
    const ok = result.results.filter((r) => r.ok).length;
    toast.success(`Job "${ev.name}" finished`, {
      description: `${ok}/${result.results.length} hosts succeeded`,
    });
  } catch (e) {
    await finishJobRun(runId, "error", JSON.stringify({ error: String(e) }));
    toast.error(`Job "${ev.name}" failed`, { description: String(e) });
  }
}

/** 注册 scheduler-job-due 监听；返回取消函数 */
export function initSchedulerListener(): UnlistenFn {
  let unlisten: UnlistenFn = () => undefined;
  void listen<SchedulerJobEvent>("scheduler-job-due", (event) => {
    void executeScheduledJob(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten();
}

export type { ScheduledJobRow };
