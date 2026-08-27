/**
 * @file 自动化与告警数据访问
 * @author Charlie
 * @description scheduled_jobs、job_runs、alert_rules、alert_events 的 CRUD。
 */

import { getDb } from "@/lib/db/client";

/** 定时任务行 */
export type ScheduledJobRow = {
  id: number;
  name: string;
  cron_expr: string;
  job_type: string;
  script_id: number | null;
  host_group_id: number | null;
  host_ids_json: string | null;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
};

/** 任务运行记录 */
export type JobRunRow = {
  id: number;
  job_id: number | null;
  job_type: string;
  status: string;
  result_json: string | null;
  started_at: string;
  finished_at: string | null;
};

/** 告警规则行 */
export type AlertRuleRow = {
  id: number;
  name: string;
  metric_type: string;
  threshold: number;
  comparison: string;
  host_id: number | null;
  host_group_id: number | null;
  session_id: string | null;
  webhook_url: string | null;
  enabled: number;
  created_at?: string;
};

/** 告警事件行 */
export type AlertEventRow = {
  id: number;
  rule_id: number;
  message: string;
  payload_json: string | null;
  read_flag: number;
  created_at: string;
};

export type ScheduledJobInput = {
  name: string;
  cron_expr: string;
  job_type?: string;
  script_id?: number | null;
  host_group_id?: number | null;
  host_ids?: number[];
  enabled?: boolean;
};

export type AlertRuleInput = {
  name: string;
  metric_type: string;
  threshold: number;
  comparison?: string;
  host_id?: number | null;
  host_group_id?: number | null;
  session_id?: string | null;
  webhook_url?: string | null;
  enabled?: boolean;
};

export async function listScheduledJobs(): Promise<ScheduledJobRow[]> {
  const db = await getDb();
  return db.select<ScheduledJobRow[]>(
    "SELECT * FROM scheduled_jobs ORDER BY id DESC",
  );
}

export async function getScheduledJob(
  id: number,
): Promise<ScheduledJobRow | null> {
  const db = await getDb();
  const rows = await db.select<ScheduledJobRow[]>(
    "SELECT * FROM scheduled_jobs WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function createScheduledJob(
  input: ScheduledJobInput,
): Promise<number> {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("job name required");
  const cron = input.cron_expr.trim();
  if (!cron) throw new Error("cron expression required");
  const hostIdsJson =
    input.host_ids && input.host_ids.length
      ? JSON.stringify(input.host_ids)
      : null;
  const result = await db.execute(
    `INSERT INTO scheduled_jobs
      (name, cron_expr, job_type, script_id, host_group_id, host_ids_json, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      name,
      cron,
      input.job_type ?? "script",
      input.script_id ?? null,
      input.host_group_id ?? null,
      hostIdsJson,
      input.enabled === false ? 0 : 1,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateScheduledJob(
  id: number,
  input: Partial<ScheduledJobInput>,
): Promise<void> {
  const db = await getDb();
  const existing = await getScheduledJob(id);
  if (!existing) throw new Error("scheduled job not found");
  const hostIdsJson =
    input.host_ids != null
      ? input.host_ids.length
        ? JSON.stringify(input.host_ids)
        : null
      : existing.host_ids_json;
  await db.execute(
    `UPDATE scheduled_jobs SET
      name=$1, cron_expr=$2, job_type=$3, script_id=$4,
      host_group_id=$5, host_ids_json=$6, enabled=$7
     WHERE id=$8`,
    [
      (input.name ?? existing.name).trim(),
      (input.cron_expr ?? existing.cron_expr).trim(),
      input.job_type ?? existing.job_type,
      input.script_id !== undefined ? input.script_id : existing.script_id,
      input.host_group_id !== undefined
        ? input.host_group_id
        : existing.host_group_id,
      hostIdsJson,
      input.enabled === false
        ? 0
        : input.enabled === true
          ? 1
          : existing.enabled,
      id,
    ],
  );
}

export async function deleteScheduledJob(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM scheduled_jobs WHERE id = $1", [id]);
}

export async function touchScheduledJobRun(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE scheduled_jobs SET last_run_at = datetime('now') WHERE id = $1",
    [id],
  );
}

export async function listJobRuns(limit = 50): Promise<JobRunRow[]> {
  const db = await getDb();
  return db.select<JobRunRow[]>(
    "SELECT * FROM job_runs ORDER BY id DESC LIMIT $1",
    [limit],
  );
}

export async function createJobRun(input: {
  job_id?: number | null;
  job_type: string;
  status?: string;
  result_json?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO job_runs (job_id, job_type, status, result_json)
     VALUES ($1,$2,$3,$4)`,
    [
      input.job_id ?? null,
      input.job_type,
      input.status ?? "running",
      input.result_json ?? null,
    ],
  );
  return result.lastInsertId as number;
}

export async function finishJobRun(
  id: number,
  status: string,
  result_json?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE job_runs SET status=$1, result_json=$2, finished_at=datetime('now')
     WHERE id=$3`,
    [status, result_json ?? null, id],
  );
}

export async function listAlertRules(): Promise<AlertRuleRow[]> {
  const db = await getDb();
  return db.select<AlertRuleRow[]>(
    "SELECT * FROM alert_rules ORDER BY id DESC",
  );
}

export async function getAlertRule(id: number): Promise<AlertRuleRow | null> {
  const db = await getDb();
  const rows = await db.select<AlertRuleRow[]>(
    "SELECT * FROM alert_rules WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function createAlertRule(input: AlertRuleInput): Promise<number> {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("rule name required");
  const result = await db.execute(
    `INSERT INTO alert_rules
      (name, metric_type, threshold, comparison, host_id, host_group_id,
       session_id, webhook_url, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      name,
      input.metric_type,
      input.threshold,
      input.comparison ?? "gt",
      input.host_id ?? null,
      input.host_group_id ?? null,
      input.session_id ?? null,
      input.webhook_url ?? null,
      input.enabled === false ? 0 : 1,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateAlertRule(
  id: number,
  input: Partial<AlertRuleInput>,
): Promise<void> {
  const db = await getDb();
  const existing = await getAlertRule(id);
  if (!existing) throw new Error("alert rule not found");
  await db.execute(
    `UPDATE alert_rules SET
      name=$1, metric_type=$2, threshold=$3, comparison=$4,
      host_id=$5, host_group_id=$6, session_id=$7, webhook_url=$8, enabled=$9
     WHERE id=$10`,
    [
      (input.name ?? existing.name).trim(),
      input.metric_type ?? existing.metric_type,
      input.threshold ?? existing.threshold,
      input.comparison ?? existing.comparison,
      input.host_id !== undefined ? input.host_id : existing.host_id,
      input.host_group_id !== undefined
        ? input.host_group_id
        : existing.host_group_id,
      input.session_id !== undefined ? input.session_id : existing.session_id,
      input.webhook_url !== undefined
        ? input.webhook_url
        : existing.webhook_url,
      input.enabled === false
        ? 0
        : input.enabled === true
          ? 1
          : existing.enabled,
      id,
    ],
  );
}

export async function deleteAlertRule(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM alert_rules WHERE id = $1", [id]);
}

export async function listAlertEvents(limit = 50): Promise<AlertEventRow[]> {
  const db = await getDb();
  return db.select<AlertEventRow[]>(
    "SELECT * FROM alert_events ORDER BY id DESC LIMIT $1",
    [limit],
  );
}

export async function createAlertEvent(input: {
  rule_id: number;
  message: string;
  payload_json?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO alert_events (rule_id, message, payload_json)
     VALUES ($1,$2,$3)`,
    [input.rule_id, input.message, input.payload_json ?? null],
  );
  return result.lastInsertId as number;
}

export async function markAlertEventRead(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE alert_events SET read_flag = 1 WHERE id = $1", [id]);
}

export async function markAllAlertEventsRead(): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE alert_events SET read_flag = 1");
}
