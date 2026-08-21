/**
 * @file SQLite 客户端
 * @author Charlie
 * @description 按后端解析的数据目录加载 sqlite 连接并缓存。
 */

import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

/** 获取（并缓存）应用 SQLite 数据库实例。 */
export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const url = await invoke<string>("get_db_url");
      return Database.load(url);
    })();
  }
  return dbPromise;
}

/** 清除缓存（切换数据目录并重启前一般不需要；供测试用）。 */
export function resetDbCache() {
  dbPromise = null;
}
