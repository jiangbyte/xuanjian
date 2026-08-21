import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:xuanjian.db");
  }
  return dbPromise;
}

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

export type GroupRow = {
  id: number;
  name: string;
  sort_order: number;
};

export type TagRow = {
  id: number;
  name: string;
};

export async function listGroups(): Promise<GroupRow[]> {
  const db = await getDb();
  return db.select<GroupRow[]>("SELECT * FROM host_groups ORDER BY sort_order, id");
}

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

export async function renameGroup(id: number, name: string) {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("group name required");
  await db.execute("UPDATE host_groups SET name = $1 WHERE id = $2", [trimmed, id]);
}

export async function deleteGroup(id: number) {
  const db = await getDb();
  await db.execute("UPDATE hosts SET group_id = NULL WHERE group_id = $1", [id]);
  await db.execute("DELETE FROM host_groups WHERE id = $1", [id]);
}

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

export async function listTags(): Promise<TagRow[]> {
  const db = await getDb();
  return db.select<TagRow[]>("SELECT * FROM tags ORDER BY name");
}

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

export async function ensureTag(name: string): Promise<number> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO tags (name) VALUES ($1)", [name]);
  const rows = await db.select<TagRow[]>("SELECT id FROM tags WHERE name = $1", [name]);
  return rows[0].id;
}

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

export async function deleteHost(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM hosts WHERE id = $1", [id]);
}

export async function touchHostConnected(id: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE hosts SET last_connected_at = datetime('now') WHERE id = $1",
    [id],
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

export type ScriptPackageRow = {
  id: number;
  name: string;
  sort_order: number;
  created_at?: string;
};

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

export type ScriptInput = {
  name: string;
  description?: string | null;
  kind?: string;
  body: string;
  package_id?: number | null;
  paste_only?: boolean;
  send_mode?: "once" | "line";
};

export async function listScriptPackages(): Promise<ScriptPackageRow[]> {
  const db = await getDb();
  return db.select<ScriptPackageRow[]>(
    "SELECT * FROM script_packages ORDER BY sort_order, id",
  );
}

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

export async function renameScriptPackage(id: number, name: string) {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("package name required");
  await db.execute("UPDATE script_packages SET name = $1 WHERE id = $2", [
    trimmed,
    id,
  ]);
}

export async function deleteScriptPackage(id: number) {
  const db = await getDb();
  await db.execute("UPDATE scripts SET package_id = NULL WHERE package_id = $1", [
    id,
  ]);
  await db.execute("DELETE FROM script_packages WHERE id = $1", [id]);
}

export async function listScripts(): Promise<ScriptRow[]> {
  const db = await getDb();
  return db.select<ScriptRow[]>(
    `SELECT s.*, p.name as package_name
     FROM scripts s
     LEFT JOIN script_packages p ON p.id = s.package_id
     ORDER BY s.sort_order, s.id`,
  );
}

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

export async function deleteScript(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM scripts WHERE id = $1", [id]);
}

export type NoteCategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  created_at?: string;
};

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

export type NoteInput = {
  title: string;
  body?: string;
  pinned?: boolean;
  category_id?: number | null;
};

export async function listNoteCategories(): Promise<NoteCategoryRow[]> {
  const db = await getDb();
  return db.select<NoteCategoryRow[]>(
    "SELECT * FROM note_categories ORDER BY sort_order, id",
  );
}

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

export async function renameNoteCategory(id: number, name: string) {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("category name required");
  await db.execute("UPDATE note_categories SET name = $1 WHERE id = $2", [
    trimmed,
    id,
  ]);
}

export async function deleteNoteCategory(id: number) {
  const db = await getDb();
  await db.execute("UPDATE notes SET category_id = NULL WHERE category_id = $1", [
    id,
  ]);
  await db.execute("DELETE FROM note_categories WHERE id = $1", [id]);
}

export async function listNotes(): Promise<NoteRow[]> {
  const db = await getDb();
  return db.select<NoteRow[]>(
    `SELECT n.*, c.name as category_name
     FROM notes n
     LEFT JOIN note_categories c ON c.id = n.category_id
     ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC`,
  );
}

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

export async function createNote(input: NoteInput): Promise<number> {
  const db = await getDb();
  const title = input.title.trim() || "未命名笔记";
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM notes",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const categoryId =
    input.category_id === undefined ? null : input.category_id;
  const result = await db.execute(
    `INSERT INTO notes (title, body, pinned, sort_order, category_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [title, input.body ?? "", input.pinned ? 1 : 0, sort, categoryId],
  );
  return result.lastInsertId as number;
}

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

export async function deleteNote(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

export async function touchNote(id: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET updated_at=datetime('now') WHERE id = $1",
    [id],
  );
}

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

export type SessionLogChunkRow = {
  id: number;
  log_id: number;
  seq: number;
  direction: "in" | "out" | string;
  t_ms: number;
  data: string;
  at?: string;
};

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

/** Batch-insert chunks; updates bytes_out once for all out data. */
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

export async function getSessionLog(
  id: number,
): Promise<SessionLogRow | null> {
  const db = await getDb();
  const rows = await db.select<SessionLogRow[]>(
    "SELECT * FROM session_logs WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

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

export async function deleteSessionLog(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM session_log_chunks WHERE log_id = $1", [id]);
  await db.execute("DELETE FROM session_logs WHERE id = $1", [id]);
}

/** Keep at least `keep` recent non-pinned logs; pinned rows are never pruned. */
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

export type NetworkHistoryRow = {
  id: number;
  kind: string;
  target: string;
  detail: string | null;
  created_at: string;
};

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
  // keep last 200
  await db.execute(
    `DELETE FROM network_history WHERE id NOT IN (
       SELECT id FROM network_history ORDER BY id DESC LIMIT 200
     )`,
  );
}

export async function listNetworkHistory(
  limit = 50,
): Promise<NetworkHistoryRow[]> {
  const db = await getDb();
  return db.select(
    "SELECT * FROM network_history ORDER BY id DESC LIMIT $1",
    [limit],
  );
}

export async function clearNetworkHistory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM network_history");
}
