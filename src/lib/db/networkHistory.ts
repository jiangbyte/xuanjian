/**
 * @file 网络工具历史数据访问
 * @author Charlie
 * @description 网络探测历史记录的增删查。
 * 自动截断为最近 200 条；不执行探测本身。
 */

import { getDb } from "@/lib/db/client";

/** 网络历史行 */
export type NetworkHistoryRow = {
  id: number;
  kind: string;
  target: string;
  detail: string | null;
  created_at: string;
};

/**
 * 追加一条网络历史，并删除超出最近 200 条之外的旧记录。
 * @param kind 工具类型（如 ping / dns）
 * @param target 目标主机或地址
 * @param detail 可选详情 JSON/文本
 */
export async function addNetworkHistory(
  kind: string,
  target: string,
  detail?: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO network_history (kind, target, detail) VALUES ($1, $2, $3)",
    [kind, target, detail ?? null],
  );
  // 仅保留最近 200 条
  await db.execute(
    `DELETE FROM network_history WHERE id NOT IN (
       SELECT id FROM network_history ORDER BY id DESC LIMIT 200
     )`,
  );
}

/**
 * 按 id 降序列出历史。
 * @param limit 默认 50
 */
export async function listNetworkHistory(
  limit = 50,
): Promise<NetworkHistoryRow[]> {
  const db = await getDb();
  return db.select("SELECT * FROM network_history ORDER BY id DESC LIMIT $1", [
    limit,
  ]);
}

/** 清空全部网络历史 */
export async function clearNetworkHistory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM network_history");
}
