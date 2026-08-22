/**
 * @file 指标快照数据访问
 * @author Charlie
 * @description metric_snapshots 写入与查询；同一会话 60 秒内至多写入一次。
 */

import { getDb } from "@/lib/db/client";

/** 指标快照行 */
export type MetricSnapshotRow = {
  id: number;
  session_id: string;
  host_id: number | null;
  payload_json: string;
  created_at: string;
};

const lastSaveAtBySession = new Map<string, number>();

/** 清除节流缓存（测试用） */
export function resetMetricThrottleCache() {
  lastSaveAtBySession.clear();
}

/**
 * 写入指标快照。
 * @returns 新行 id；若 60 秒内已写入则返回 null
 */
export async function insertMetricSnapshot(
  sessionId: string,
  hostId: number | null | undefined,
  payload: unknown,
  opts?: { force?: boolean },
): Promise<number | null> {
  const now = Date.now();
  const last = lastSaveAtBySession.get(sessionId) ?? 0;
  if (!opts?.force && now - last < 60_000) return null;
  lastSaveAtBySession.set(sessionId, now);

  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO metric_snapshots (session_id, host_id, payload_json)
     VALUES ($1,$2,$3)`,
    [sessionId, hostId ?? null, JSON.stringify(payload)],
  );
  return result.lastInsertId as number;
}

/** 列出指标快照（可按 session 过滤） */
export async function listMetricSnapshots(
  opts?: { sessionId?: string; hostId?: number; limit?: number },
): Promise<MetricSnapshotRow[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 50;
  if (opts?.sessionId) {
    return db.select<MetricSnapshotRow[]>(
      `SELECT * FROM metric_snapshots
       WHERE session_id = $1
       ORDER BY id DESC LIMIT $2`,
      [opts.sessionId, limit],
    );
  }
  if (opts?.hostId != null) {
    return db.select<MetricSnapshotRow[]>(
      `SELECT * FROM metric_snapshots
       WHERE host_id = $1
       ORDER BY id DESC LIMIT $2`,
      [opts.hostId, limit],
    );
  }
  return db.select<MetricSnapshotRow[]>(
    "SELECT * FROM metric_snapshots ORDER BY id DESC LIMIT $1",
    [limit],
  );
}

/** 取某会话最近一条快照 */
export async function getLatestMetricSnapshot(
  sessionId: string,
): Promise<MetricSnapshotRow | null> {
  const rows = await listMetricSnapshots({ sessionId, limit: 1 });
  return rows[0] ?? null;
}
