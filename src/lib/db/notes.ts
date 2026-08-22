/**
 * @file 笔记与分类数据访问
 * @author Charlie
 * @description 笔记分类与笔记 CRUD。
 * 正文存库为纯文本/Markdown；不负责编辑器 UI。
 */

import { getDb } from "@/lib/db/client";

/** 笔记分类行 */
export type NoteCategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  created_at?: string;
};

/** 笔记行（可含 category_name） */
export type NoteRow = {
  id: number;
  title: string;
  body: string;
  pinned: number;
  sort_order: number;
  category_id: number | null;
  category_name?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** 新建 / 更新笔记输入 */
export type NoteInput = {
  title: string;
  body?: string;
  pinned?: boolean;
  category_id?: number | null;
};

/** 按 sort_order 列出笔记分类 */
export async function listNoteCategories(): Promise<NoteCategoryRow[]> {
  const db = await getDb();
  return db.select<NoteCategoryRow[]>(
    "SELECT * FROM note_categories ORDER BY sort_order, id",
  );
}

/**
 * 新建笔记分类。
 * @returns 新分类 id
 * @throws 名为空时抛错
 */
export async function createNoteCategory(name: string): Promise<number> {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("category name required");
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM note_categories",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO note_categories (name, sort_order) VALUES ($1, $2)",
    [trimmed, sort],
  );
  return result.lastInsertId as number;
}

/**
 * 重命名笔记分类。
 * @throws 名为空时抛错
 */
export async function renameNoteCategory(id: number, name: string) {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("category name required");
  await db.execute("UPDATE note_categories SET name = $1 WHERE id = $2", [
    trimmed,
    id,
  ]);
}

/**
 * 删除分类；其下笔记的 category_id 置空。
 */
export async function deleteNoteCategory(id: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET category_id = NULL WHERE category_id = $1",
    [id],
  );
  await db.execute("DELETE FROM note_categories WHERE id = $1", [id]);
}

/** 列出笔记：置顶优先，再按 updated_at 降序 */
export async function listNotes(): Promise<NoteRow[]> {
  const db = await getDb();
  return db.select<NoteRow[]>(
    `SELECT n.*, c.name as category_name
     FROM notes n
     LEFT JOIN note_categories c ON c.id = n.category_id
     ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC`,
  );
}

/**
 * 按 id 取单条笔记。
 * @returns 不存在则为 null
 */
export async function getNote(id: number): Promise<NoteRow | null> {
  const db = await getDb();
  const rows = await db.select<NoteRow[]>(
    `SELECT n.*, c.name as category_name
     FROM notes n
     LEFT JOIN note_categories c ON c.id = n.category_id
     WHERE n.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * 新建笔记；空标题时使用「未命名笔记」。
 * @returns 新笔记 id
 */
export async function createNote(input: NoteInput): Promise<number> {
  const db = await getDb();
  const title = input.title.trim() || "未命名笔记";
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM notes",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const categoryId = input.category_id === undefined ? null : input.category_id;
  const result = await db.execute(
    `INSERT INTO notes (title, body, pinned, sort_order, category_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [title, input.body ?? "", input.pinned ? 1 : 0, sort, categoryId],
  );
  return result.lastInsertId as number;
}

/** 更新笔记并刷新 updated_at */
export async function updateNote(id: number, input: NoteInput) {
  const db = await getDb();
  await db.execute(
    `UPDATE notes SET
      title=$1, body=$2, pinned=$3, category_id=$4, updated_at=datetime('now')
     WHERE id=$5`,
    [
      input.title.trim() || "未命名笔记",
      input.body ?? "",
      input.pinned ? 1 : 0,
      input.category_id === undefined ? null : input.category_id,
      id,
    ],
  );
}

/** 按 id 删除笔记 */
export async function deleteNote(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

/** 按标题/正文关键词搜索笔记 */
export async function searchNotes(
  query: string,
  limit = 20,
): Promise<NoteRow[]> {
  const q = query.trim();
  if (!q) return listNotes();
  const db = await getDb();
  const like = `%${q}%`;
  const lim = Math.min(Math.max(limit, 1), 60);
  return db.select<NoteRow[]>(
    `SELECT n.*, c.name as category_name
     FROM notes n
     LEFT JOIN note_categories c ON c.id = n.category_id
     WHERE n.title LIKE $1 OR n.body LIKE $1
     ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
     LIMIT ${lim}`,
    [like],
  );
}

/** 仅刷新笔记 updated_at（如预览打开时） */
export async function touchNote(id: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET updated_at=datetime('now') WHERE id = $1",
    [id],
  );
}
