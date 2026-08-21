/**
 * @file 应用设置数据访问
 * @author Charlie
 * @description 读写 app_settings 键值对。
 * 与前端 settings store 配合；本模块只做 SQLite 存取。
 */

import { getDb } from "@/lib/db/client";

/**
 * 读取设置值。
 * @param key 设置键
 * @returns 不存在则为 null
 */
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

/**
 * 写入设置（存在则更新）。
 * @param key 设置键
 * @param value 字符串值
 */
export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}
