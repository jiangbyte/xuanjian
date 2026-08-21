/**
 * @file Docker 编排项目数据访问
 * @author Charlie
 * @description 项目 CRUD；compose / dockerfiles / 画布布局以 JSON 文本存库。
 */

import { getDb } from "@/lib/db/client";

/** docker_projects 表行 */
export type DockerProjectRow = {
  id: number;
  name: string;
  description: string;
  compose_json: string;
  dockerfiles_json: string;
  layout_json: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

/** 新建 / 更新输入 */
export type DockerProjectInput = {
  name: string;
  description?: string;
  compose_json?: string;
  dockerfiles_json?: string;
  layout_json?: string;
};

/** 按更新时间倒序列出项目 */
export async function listDockerProjects(): Promise<DockerProjectRow[]> {
  const db = await getDb();
  return db.select<DockerProjectRow[]>(
    "SELECT * FROM docker_projects ORDER BY updated_at DESC, id DESC",
  );
}

/** 按 id 读取项目 */
export async function getDockerProject(
  id: number,
): Promise<DockerProjectRow | null> {
  const db = await getDb();
  const rows = await db.select<DockerProjectRow[]>(
    "SELECT * FROM docker_projects WHERE id = ?",
    [id],
  );
  return rows[0] ?? null;
}

/**
 * 新建编排项目。
 * @returns 新项目 id
 */
export async function createDockerProject(
  input: DockerProjectInput,
): Promise<number> {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("project name required");
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM docker_projects",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    `INSERT INTO docker_projects
      (name, description, compose_json, dockerfiles_json, layout_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      name,
      input.description?.trim() ?? "",
      input.compose_json ?? "{}",
      input.dockerfiles_json ?? "{}",
      input.layout_json ?? "{}",
      sort,
    ],
  );
  return Number(result.lastInsertId);
}

/** 更新编排项目（含 touch updated_at） */
export async function updateDockerProject(
  id: number,
  input: Partial<DockerProjectInput>,
): Promise<void> {
  const db = await getDb();
  const cur = await getDockerProject(id);
  if (!cur) throw new Error("project not found");
  const name = input.name != null ? input.name.trim() : cur.name;
  if (!name) throw new Error("project name required");
  await db.execute(
    `UPDATE docker_projects SET
      name = ?,
      description = ?,
      compose_json = ?,
      dockerfiles_json = ?,
      layout_json = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    [
      name,
      input.description ?? cur.description,
      input.compose_json ?? cur.compose_json,
      input.dockerfiles_json ?? cur.dockerfiles_json,
      input.layout_json ?? cur.layout_json,
      id,
    ],
  );
}

/** 删除编排项目 */
export async function deleteDockerProject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM docker_projects WHERE id = ?", [id]);
}
