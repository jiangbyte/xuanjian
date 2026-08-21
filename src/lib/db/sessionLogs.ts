/**
 * @file 会话日志数据访问
 * @author Charlie
 * @description 会话录制元数据与分片的读写、置顶与清理。
 * 不负责实时捕获；由 sessionRecorder 调用本层写入。
 */

import { getDb } from "@/lib/db/client";

/** 会话日志元数据行 */
export type SessionLogRow = {
  id: number;
  tab_id: string | null;
  session_id: string | null;
  kind: "local" | "ssh" | string;
  host_id: number | null;
  shell_id: string | null;
  title: string;
  remote_user: string | null;
  remote_host: string | null;
  pinned: number;
  status: "open" | "closed" | "error" | string;
  started_at: string;
  ended_at: string | null;
  bytes_out: number;
  created_at?: string;
};

/** 会话日志分片行（输入/输出数据块） */
export type SessionLogChunkRow = {
  id: number;
  log_id: number;
  seq: number;
  direction: "in" | "out" | string;
  t_ms: number;
  data: string;
  at?: string;
};

/** 创建会话日志时的输入 */
export type SessionLogCreateInput = {
  tabId?: string | null;
  sessionId?: string | null;
  kind: string;
  hostId?: number | null;
  shellId?: string | null;
  title: string;
  remoteUser?: string | null;
  remoteHost?: string | null;
  startedAt?: string;
};

/**
 * 创建一条 open 状态的会话日志。
 * @returns 新日志 id
 */
export async function createSessionLog(
  input: SessionLogCreateInput,
): Promise<number> {
  const db = await getDb();
  const startedAt = input.startedAt ?? new Date().toISOString();
  const result = await db.execute(
    `INSERT INTO session_logs (
      tab_id, session_id, kind, host_id, shell_id, title,
      remote_user, remote_host, pinned, status, started_at, bytes_out
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'open', $9, 0)`,
    [
      input.tabId ?? null,
      input.sessionId ?? null,
      input.kind,
      input.hostId ?? null,
      input.shellId ?? null,
      input.title.trim() || "session",
      input.remoteUser ?? null,
      input.remoteHost ?? null,
      startedAt,
    ],
  );
  return result.lastInsertId as number;
}

/**
 * 追加单个分片；out 方向时累加 bytes_out。
 * @param seq 分片序号
 * @param direction in=输入 / out=输出
 * @param tMs 相对起始的毫秒
 */
export async function appendLogChunk(
  logId: number,
  seq: number,
  direction: "in" | "out",
  data: string,
  tMs: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO session_log_chunks (log_id, seq, direction, t_ms, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [logId, seq, direction, tMs, data],
  );
  if (direction === "out" && data.length > 0) {
    await db.execute(
      "UPDATE session_logs SET bytes_out = bytes_out + $1 WHERE id = $2",
      [data.length, logId],
    );
  }
}

/**
 * 批量插入分片；一次性累加全部 out 字节到 bytes_out。
 */
export async function appendLogChunks(
  logId: number,
  chunks: Array<{
    seq: number;
    direction: "in" | "out";
    data: string;
    tMs: number;
  }>,
): Promise<void> {
  if (chunks.length === 0) return;
  const db = await getDb();
  let outBytes = 0;
  for (const c of chunks) {
    await db.execute(
      `INSERT INTO session_log_chunks (log_id, seq, direction, t_ms, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [logId, c.seq, c.direction, c.tMs, c.data],
    );
    if (c.direction === "out") outBytes += c.data.length;
  }
  if (outBytes > 0) {
    await db.execute(
      "UPDATE session_logs SET bytes_out = bytes_out + $1 WHERE id = $2",
      [outBytes, logId],
    );
  }
}

/**
 * 结束会话日志：写入 status 与 ended_at。
 * @param status 默认 `"closed"`
 */
export async function finalizeSessionLog(
  logId: number,
  status: "closed" | "error" = "closed",
  endedAt?: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE session_logs SET status = $1, ended_at = $2 WHERE id = $3`,
    [status, endedAt ?? new Date().toISOString(), logId],
  );
}

/**
 * 将仍为 open、且不在 keepSessionIds 中的日志标记为已结束。
 * 用于应用启动 / 标签已关但录制未 finalize 的孤儿记录。
 * @returns 收尾条数
 */
export async function finalizeOrphanOpenLogs(
  keepSessionIds: string[] = [],
): Promise<number> {
  const db = await getDb();
  const keep = new Set(keepSessionIds.filter(Boolean));
  const openRows = await db.select<{ id: number; session_id: string | null }[]>(
    `SELECT id, session_id FROM session_logs WHERE status = 'open'`,
  );
  const endedAt = new Date().toISOString();
  let n = 0;
  for (const row of openRows) {
    if (row.session_id && keep.has(row.session_id)) continue;
    await db.execute(
      `UPDATE session_logs SET status = 'closed', ended_at = $1 WHERE id = $2 AND status = 'open'`,
      [endedAt, row.id],
    );
    n += 1;
  }
  return n;
}

/**
 * 列出会话日志（置顶优先，再按 started_at 降序）。
 * @param opts.kind 按 ssh/local 过滤
 * @param opts.search 标题 / 远端主机 / 用户模糊匹配
 */
export async function listSessionLogs(opts?: {
  kind?: "ssh" | "local" | null;
  search?: string;
}): Promise<SessionLogRow[]> {
  const db = await getDb();
  const kind = opts?.kind ?? null;
  const search = opts?.search?.trim() ?? "";
  const params: unknown[] = [];
  const where: string[] = [];
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  if (search) {
    const like = `%${search}%`;
    params.push(like, like, like);
    const a = params.length - 2;
    const b = params.length - 1;
    const c = params.length;
    where.push(
      `(title LIKE $${a} OR IFNULL(remote_host,'') LIKE $${b} OR IFNULL(remote_user,'') LIKE $${c})`,
    );
  }
  const sql = `SELECT * FROM session_logs
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY pinned DESC, started_at DESC, id DESC`;
  return db.select<SessionLogRow[]>(sql, params);
}

/**
 * 按 id 取会话日志元数据。
 * @returns 不存在则为 null
 */
export async function getSessionLog(id: number): Promise<SessionLogRow | null> {
  const db = await getDb();
  const rows = await db.select<SessionLogRow[]>(
    "SELECT * FROM session_logs WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/**
 * 按序号列出某日志的分片。
 * @param opts.direction 可选，仅取 in 或 out
 */
export async function listSessionLogChunks(
  logId: number,
  opts?: { direction?: "in" | "out" | null },
): Promise<SessionLogChunkRow[]> {
  const db = await getDb();
  if (opts?.direction) {
    return db.select<SessionLogChunkRow[]>(
      `SELECT * FROM session_log_chunks
       WHERE log_id = $1 AND direction = $2
       ORDER BY seq ASC, id ASC`,
      [logId, opts.direction],
    );
  }
  return db.select<SessionLogChunkRow[]>(
    `SELECT * FROM session_log_chunks
     WHERE log_id = $1
     ORDER BY seq ASC, id ASC`,
    [logId],
  );
}

/** 设置会话日志置顶状态 */
export async function setSessionLogPinned(
  id: number,
  pinned: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE session_logs SET pinned = $1 WHERE id = $2", [
    pinned ? 1 : 0,
    id,
  ]);
}

/**
 * 删除会话日志及其全部分片。
 */
export async function deleteSessionLog(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM session_log_chunks WHERE log_id = $1", [id]);
  await db.execute("DELETE FROM session_logs WHERE id = $1", [id]);
}

/**
 * 清理旧日志：至少保留 `keep` 条最近的非置顶记录；置顶永不删。
 * @param keep 默认 1000
 */
export async function pruneSessionLogs(keep = 1000): Promise<void> {
  const db = await getDb();
  const keepN = Math.max(0, keep);
  const doomed = await db.select<{ id: number }[]>(
    `SELECT id FROM session_logs
     WHERE pinned = 0
     ORDER BY started_at DESC, id DESC
     LIMIT -1 OFFSET $1`,
    [keepN],
  );
  for (const row of doomed) {
    await db.execute("DELETE FROM session_log_chunks WHERE log_id = $1", [
      row.id,
    ]);
    await db.execute("DELETE FROM session_logs WHERE id = $1", [row.id]);
  }
}
