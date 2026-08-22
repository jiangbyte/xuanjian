/**
 * @file 命令历史 SQLite 访问
 * @author Charlie
 */

import { getDb } from "@/lib/db/client";

export type CmdHistoryRow = {
  id: number;
  cmd: string;
  session_id: string | null;
  host_id: number | null;
  label: string | null;
  created_at: string;
};

const MAX_ROWS = 500;
const IMPORT_KEY = "xuanjian.cmdHistory.imported";

export async function insertCmdHistory(input: {
  cmd: string;
  sessionId?: string | null;
  hostId?: number | null;
  label?: string | null;
}): Promise<number> {
  const cmd = input.cmd.trim();
  if (!cmd) return 0;
  const db = await getDb();
  await db.execute(
    "DELETE FROM cmd_history WHERE cmd = $1 AND COALESCE(session_id,'') = COALESCE($2,'')",
    [cmd, input.sessionId ?? null],
  );
  const result = await db.execute(
    `INSERT INTO cmd_history (cmd, session_id, host_id, label)
     VALUES ($1, $2, $3, $4)`,
    [cmd, input.sessionId ?? null, input.hostId ?? null, input.label ?? null],
  );
  const count = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) as c FROM cmd_history",
  );
  const excess = (count[0]?.c ?? 0) - MAX_ROWS;
  if (excess > 0) {
    await db.execute(
      `DELETE FROM cmd_history WHERE id IN (
        SELECT id FROM cmd_history ORDER BY created_at ASC LIMIT $1
      )`,
      [excess],
    );
  }
  return result.lastInsertId as number;
}

export async function listCmdHistory(opts?: {
  sessionId?: string | null;
  query?: string;
  limit?: number;
}): Promise<CmdHistoryRow[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 120);
  const params: unknown[] = [];
  let sql = "SELECT * FROM cmd_history WHERE 1=1";
  if (opts?.sessionId) {
    sql += " AND session_id = $1";
    params.push(opts.sessionId);
  }
  if (opts?.query?.trim()) {
    const idx = params.length + 1;
    sql += ` AND (cmd LIKE $${idx} OR COALESCE(label,'') LIKE $${idx})`;
    params.push(`%${opts.query.trim()}%`);
  }
  sql += ` ORDER BY datetime(created_at) DESC LIMIT ${limit}`;
  return db.select<CmdHistoryRow[]>(sql, params);
}

export async function searchCmdHistory(
  query: string,
  limit = 40,
): Promise<CmdHistoryRow[]> {
  return listCmdHistory({ query, limit });
}

export async function clearCmdHistory() {
  const db = await getDb();
  await db.execute("DELETE FROM cmd_history");
}

/** 一次性从 localStorage 迁入 SQLite */
export async function importCmdHistoryFromLocalStorage(): Promise<number> {
  if (localStorage.getItem(IMPORT_KEY) === "1") return 0;
  let imported = 0;
  try {
    const raw = localStorage.getItem("xuanjian.cmdHistory");
    if (!raw) {
      localStorage.setItem(IMPORT_KEY, "1");
      return 0;
    }
    const parsed = JSON.parse(raw) as Array<{
      cmd: string;
      sessionId?: string | null;
      label?: string;
      at?: number;
    }>;
    if (!Array.isArray(parsed)) return 0;
    for (const item of parsed.slice(0, MAX_ROWS)) {
      if (!item?.cmd?.trim()) continue;
      await insertCmdHistory({
        cmd: item.cmd,
        sessionId: item.sessionId ?? null,
        label: item.label ?? null,
      });
      imported += 1;
    }
    localStorage.setItem(IMPORT_KEY, "1");
  } catch {
    localStorage.setItem(IMPORT_KEY, "1");
  }
  return imported;
}
