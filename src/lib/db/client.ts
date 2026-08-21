/**
 * @file SQLite 客户端
 * @author Charlie
 * @description 加载并缓存 sqlite:xuanjian.db 连接。
 */

import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

/** 获取（并缓存）应用 SQLite 数据库实例。 */
export async function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:xuanjian.db");
  }
  return dbPromise;
}
