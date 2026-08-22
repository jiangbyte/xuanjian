/**
 * @file 脚本包与脚本数据访问
 * @author Charlie
 * @description 脚本包、脚本的 CRUD。
 * 不负责向终端发送脚本内容。
 */

import { getDb } from "@/lib/db/client";

/** 脚本包行 */
export type ScriptPackageRow = {
  id: number;
  name: string;
  sort_order: number;
  created_at?: string;
};

/** 脚本行（可含 package_name） */
export type ScriptRow = {
  id: number;
  name: string;
  description: string | null;
  kind: string;
  body: string;
  package_id: number | null;
  paste_only: number;
  send_mode: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  package_name?: string | null;
};

/** 新建 / 更新脚本输入 */
export type ScriptInput = {
  name: string;
  description?: string | null;
  kind?: string;
  body: string;
  package_id?: number | null;
  paste_only?: boolean;
  send_mode?: "once" | "line";
};

/** 按 sort_order 列出脚本包 */
export async function listScriptPackages(): Promise<ScriptPackageRow[]> {
  const db = await getDb();
  return db.select<ScriptPackageRow[]>(
    "SELECT * FROM script_packages ORDER BY sort_order, id",
  );
}

/**
 * 新建脚本包。
 * @returns 新包 id
 * @throws 名为空时抛错
 */
export async function createScriptPackage(name: string): Promise<number> {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("package name required");
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM script_packages",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO script_packages (name, sort_order) VALUES ($1, $2)",
    [trimmed, sort],
  );
  return result.lastInsertId as number;
}

/**
 * 重命名脚本包。
 * @throws 名为空时抛错
 */
export async function renameScriptPackage(id: number, name: string) {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("package name required");
  await db.execute("UPDATE script_packages SET name = $1 WHERE id = $2", [
    trimmed,
    id,
  ]);
}

/**
 * 删除脚本包；其下脚本的 package_id 置空。
 */
export async function deleteScriptPackage(id: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE scripts SET package_id = NULL WHERE package_id = $1",
    [id],
  );
  await db.execute("DELETE FROM script_packages WHERE id = $1", [id]);
}

/** 列出全部脚本（含包名） */
export async function listScripts(): Promise<ScriptRow[]> {
  const db = await getDb();
  return db.select<ScriptRow[]>(
    `SELECT s.*, p.name as package_name
     FROM scripts s
     LEFT JOIN script_packages p ON p.id = s.package_id
     ORDER BY s.sort_order, s.id`,
  );
}

/** 按 id 取单条脚本（含包名） */
export async function getScript(id: number): Promise<ScriptRow | null> {
  const db = await getDb();
  const rows = await db.select<ScriptRow[]>(
    `SELECT s.*, p.name as package_name
     FROM scripts s
     LEFT JOIN script_packages p ON p.id = s.package_id
     WHERE s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * 新建脚本。
 * @returns 新脚本 id
 */
export async function createScript(input: ScriptInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO scripts (name, description, kind, body, package_id, paste_only, send_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.name.trim(),
      input.description ?? null,
      input.kind ?? "snippet",
      input.body,
      input.package_id ?? null,
      input.paste_only ? 1 : 0,
      input.send_mode ?? "once",
    ],
  );
  return result.lastInsertId as number;
}

/** 更新脚本并刷新 updated_at */
export async function updateScript(id: number, input: ScriptInput) {
  const db = await getDb();
  await db.execute(
    `UPDATE scripts SET
      name=$1, description=$2, kind=$3, body=$4, package_id=$5,
      paste_only=$6, send_mode=$7, updated_at=datetime('now')
     WHERE id=$8`,
    [
      input.name.trim(),
      input.description ?? null,
      input.kind ?? "snippet",
      input.body,
      input.package_id ?? null,
      input.paste_only ? 1 : 0,
      input.send_mode ?? "once",
      id,
    ],
  );
}

/** 按 id 删除脚本 */
export async function deleteScript(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM scripts WHERE id = $1", [id]);
}
