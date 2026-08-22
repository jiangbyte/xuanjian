/**
 * @file 审计事件 SQLite 访问
 * @author Charlie
 */

import { getDb } from "@/lib/db/client";

export type AuditEventRow = {
  id: number;
  action: string;
  actor: string;
  target: string | null;
  detail_json: string | null;
  created_at: string;
};

export type AuditAction =
  | "agent.tool_confirm"
  | "agent.tool_exec"
  | "ssh.connect"
  | "ssh.host_key"
  | "batch.run"
  | "deploy.run"
  | "schedule.run"
  | "alert.trigger"
  | "file.write"
  | "file.delete";

export async function insertAuditEvent(input: {
  action: AuditAction | string;
  actor?: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO audit_events (action, actor, target, detail_json)
     VALUES ($1, $2, $3, $4)`,
    [
      input.action,
      input.actor ?? "user",
      input.target ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
    ],
  );
  return result.lastInsertId as number;
}

export async function listAuditEvents(opts?: {
  action?: string;
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditEventRow[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const params: unknown[] = [];
  let sql = "SELECT * FROM audit_events WHERE 1=1";
  if (opts?.action) {
    params.push(opts.action);
    sql += ` AND action = $${params.length}`;
  }
  if (opts?.query?.trim()) {
    params.push(`%${opts.query.trim()}%`);
    const i = params.length;
    sql += ` AND (target LIKE $${i} OR detail_json LIKE $${i})`;
  }
  sql += ` ORDER BY datetime(created_at) DESC LIMIT ${limit} OFFSET ${offset}`;
  return db.select<AuditEventRow[]>(sql, params);
}

export async function summarizeAuditEvents(limit = 50) {
  const db = await getDb();
  const totalRows = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) as c FROM audit_events",
  );
  const byActionRows = await db.select<{ action: string; c: number }[]>(
    "SELECT action, COUNT(*) as c FROM audit_events GROUP BY action ORDER BY c DESC",
  );
  const recent = await listAuditEvents({ limit });
  const byAction: Record<string, number> = {};
  for (const row of byActionRows) {
    byAction[row.action] = row.c;
  }
  return {
    total: totalRows[0]?.c ?? 0,
    byAction,
    recent: recent.map((r) => ({
      action: r.action,
      target: r.target,
      created_at: r.created_at,
    })),
  };
}

export async function pruneAuditEvents(retentionDays: number) {
  if (retentionDays <= 0) return;
  const db = await getDb();
  await db.execute(
    `DELETE FROM audit_events
     WHERE datetime(created_at) < datetime('now', $1)`,
    [`-${retentionDays} days`],
  );
}
