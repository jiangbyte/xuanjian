/**
 * @file 主机 / 分组 / 标签数据访问
 * @author Charlie
 * @description 主机清单、分组、标签的 CRUD 与关联更新。
 * 凭证字段以加密形态存库；不负责实际 SSH 连接。
 */

import { getDb } from "@/lib/db/client";

/** 主机行（含可选 group_name / tags 聚合） */
export type HostRow = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  password_enc: string | null;
  private_key_path: string | null;
  passphrase_enc: string | null;
  group_id: number | null;
  last_connected_at: string | null;
  sort_order: number;
  created_at: string;
  remark?: string | null;
  color?: string | null;
  connect_timeout?: number | null;
  keepalive_interval?: number | null;
  terminal_type?: string | null;
  startup_cmd?: string | null;
  remote_path?: string | null;
  jump_host_id?: number | null;
  group_name?: string | null;
  tags?: string;
};

/** 主机分组行 */
export type GroupRow = {
  id: number;
  name: string;
  sort_order: number;
};

/** 标签行 */
export type TagRow = {
  id: number;
  name: string;
};

/** 按 sort_order 列出全部分组 */
export async function listGroups(): Promise<GroupRow[]> {
  const db = await getDb();
  return db.select<GroupRow[]>(
    "SELECT * FROM host_groups ORDER BY sort_order, id",
  );
}

/**
 * 新建分组，sort_order 接在末尾。
 * @param name 分组名（去空白）
 * @returns 新分组 id
 * @throws 名为空时抛错
 */
export async function createGroup(name: string): Promise<number> {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("group name required");
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM host_groups",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO host_groups (name, sort_order) VALUES ($1, $2)",
    [trimmed, sort],
  );
  return result.lastInsertId as number;
}

/**
 * 重命名分组。
 * @throws 名为空时抛错
 */
export async function renameGroup(id: number, name: string) {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("group name required");
  await db.execute("UPDATE host_groups SET name = $1 WHERE id = $2", [
    trimmed,
    id,
  ]);
}

/**
 * 删除分组；其下主机的 group_id 置空（不删主机）。
 */
export async function deleteGroup(id: number) {
  const db = await getDb();
  await db.execute("UPDATE hosts SET group_id = NULL WHERE group_id = $1", [
    id,
  ]);
  await db.execute("DELETE FROM host_groups WHERE id = $1", [id]);
}

/**
 * 与相邻分组交换 sort_order，实现上移/下移。
 * @param direction `"up"` 或 `"down"`；越界则无操作
 */
export async function moveGroup(id: number, direction: "up" | "down") {
  const groups = await listGroups();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx < 0) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= groups.length) return;
  const a = groups[idx];
  const b = groups[swapIdx];
  const db = await getDb();
  await db.execute("UPDATE host_groups SET sort_order = $1 WHERE id = $2", [
    b.sort_order,
    a.id,
  ]);
  await db.execute("UPDATE host_groups SET sort_order = $1 WHERE id = $2", [
    a.sort_order,
    b.id,
  ]);
}

/** 按名称列出全部标签 */
export async function listTags(): Promise<TagRow[]> {
  const db = await getDb();
  return db.select<TagRow[]>("SELECT * FROM tags ORDER BY name");
}

/** 列出主机（含分组名与逗号拼接 tags） */
export async function listHosts(): Promise<HostRow[]> {
  const db = await getDb();
  return db.select<HostRow[]>(
    `SELECT h.*, g.name as group_name,
      (SELECT GROUP_CONCAT(t.name, ',') FROM host_tags ht
        JOIN tags t ON t.id = ht.tag_id WHERE ht.host_id = h.id) as tags
     FROM hosts h
     LEFT JOIN host_groups g ON g.id = h.group_id
     ORDER BY h.sort_order, h.id`,
  );
}

/**
 * 按 id 取单台主机（含分组与标签聚合）。
 * @returns 不存在则为 null
 */
export async function getHost(id: number): Promise<HostRow | null> {
  const db = await getDb();
  const rows = await db.select<HostRow[]>(
    `SELECT h.*, g.name as group_name,
      (SELECT GROUP_CONCAT(t.name, ',') FROM host_tags ht
        JOIN tags t ON t.id = ht.tag_id WHERE ht.host_id = h.id) as tags
     FROM hosts h
     LEFT JOIN host_groups g ON g.id = h.group_id
     WHERE h.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * 确保标签存在并返回 id（INSERT OR IGNORE）。
 */
export async function ensureTag(name: string): Promise<number> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO tags (name) VALUES ($1)", [name]);
  const rows = await db.select<TagRow[]>(
    "SELECT id FROM tags WHERE name = $1",
    [name],
  );
  return rows[0].id;
}

/**
 * 重置主机标签关联为给定名称列表。
 * @副作用 先删 host_tags，再 ensureTag 并插入
 */
export async function setHostTags(hostId: number, tagNames: string[]) {
  const db = await getDb();
  await db.execute("DELETE FROM host_tags WHERE host_id = $1", [hostId]);
  for (const name of tagNames.map((t) => t.trim()).filter(Boolean)) {
    const tagId = await ensureTag(name);
    await db.execute(
      "INSERT OR IGNORE INTO host_tags (host_id, tag_id) VALUES ($1, $2)",
      [hostId, tagId],
    );
  }
}

/** 新建 / 更新主机时的输入字段 */
export type HostInput = {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  password_enc?: string | null;
  private_key_path?: string | null;
  passphrase_enc?: string | null;
  group_id?: number | null;
  tags?: string[];
  remark?: string | null;
  color?: string | null;
  connect_timeout?: number | null;
  keepalive_interval?: number | null;
  terminal_type?: string | null;
  startup_cmd?: string | null;
  remote_path?: string | null;
  jump_host_id?: number | null;
};

/**
 * 插入主机；若带 tags 则一并 setHostTags。
 * @returns 新主机 id
 */
export async function createHost(input: HostInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO hosts (
      name, host, port, username, auth_type, password_enc, private_key_path, passphrase_enc,
      group_id, remark, color, connect_timeout, keepalive_interval, terminal_type,
      startup_cmd, remote_path, jump_host_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      input.name,
      input.host,
      input.port,
      input.username,
      input.auth_type,
      input.password_enc ?? null,
      input.private_key_path ?? null,
      input.passphrase_enc ?? null,
      input.group_id ?? null,
      input.remark ?? null,
      input.color ?? null,
      input.connect_timeout ?? 30,
      input.keepalive_interval ?? 60,
      input.terminal_type ?? "xterm-256color",
      input.startup_cmd ?? null,
      input.remote_path ?? null,
      input.jump_host_id ?? null,
    ],
  );
  const id = result.lastInsertId as number;
  if (input.tags?.length) await setHostTags(id, input.tags);
  return id;
}

/**
 * 更新主机字段；若传入 tags 则同步标签关联。
 */
export async function updateHost(id: number, input: HostInput) {
  const db = await getDb();
  await db.execute(
    `UPDATE hosts SET
      name=$1, host=$2, port=$3, username=$4, auth_type=$5,
      password_enc=$6, private_key_path=$7, passphrase_enc=$8, group_id=$9,
      remark=$10, color=$11, connect_timeout=$12, keepalive_interval=$13,
      terminal_type=$14, startup_cmd=$15, remote_path=$16, jump_host_id=$17
     WHERE id=$18`,
    [
      input.name,
      input.host,
      input.port,
      input.username,
      input.auth_type,
      input.password_enc ?? null,
      input.private_key_path ?? null,
      input.passphrase_enc ?? null,
      input.group_id ?? null,
      input.remark ?? null,
      input.color ?? null,
      input.connect_timeout ?? 30,
      input.keepalive_interval ?? 60,
      input.terminal_type ?? "xterm-256color",
      input.startup_cmd ?? null,
      input.remote_path ?? null,
      input.jump_host_id ?? null,
      id,
    ],
  );
  if (input.tags) await setHostTags(id, input.tags);
}

/** 按 id 删除主机（依赖库表 CASCADE 清关联） */
export async function deleteHost(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM hosts WHERE id = $1", [id]);
}

/** 更新主机最近连接时间为当前 UTC */
export async function touchHostConnected(id: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE hosts SET last_connected_at = datetime('now') WHERE id = $1",
    [id],
  );
}
