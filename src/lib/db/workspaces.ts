/**
 * @file 工作空间 SQLite 访问
 * @author Charlie
 */

import { getDb } from "@/lib/db/client";

export type WorkspaceRow = {
  id: number;
  name: string;
  local_root: string;
  host_id: number;
  remote_root: string;
  exclude_patterns: string | null;
  deploy_recipe: string | null;
  tab_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkspaceInput = {
  name: string;
  local_root: string;
  host_id: number;
  remote_root?: string;
  exclude_patterns?: string | null;
  deploy_recipe?: string | null;
  tab_id?: string | null;
};

export async function listWorkspaces(): Promise<WorkspaceRow[]> {
  const db = await getDb();
  return db.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces ORDER BY datetime(updated_at) DESC, id DESC",
  );
}

export async function getWorkspace(id: number): Promise<WorkspaceRow | null> {
  const db = await getDb();
  const rows = await db.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function findWorkspaceByTabId(
  tabId: string,
): Promise<WorkspaceRow | null> {
  const db = await getDb();
  const rows = await db.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces WHERE tab_id = $1 ORDER BY datetime(updated_at) DESC LIMIT 1",
    [tabId],
  );
  return rows[0] ?? null;
}

export async function findWorkspacesByHostId(
  hostId: number,
): Promise<WorkspaceRow[]> {
  const db = await getDb();
  return db.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces WHERE host_id = $1 ORDER BY datetime(updated_at) DESC, id DESC",
    [hostId],
  );
}

export async function createWorkspace(input: WorkspaceInput): Promise<number> {
  const db = await getDb();
  const name = input.name.trim();
  const localRoot = input.local_root.trim();
  if (!name) throw new Error("workspace name required");
  if (!localRoot) throw new Error("local_root required");
  const result = await db.execute(
    `INSERT INTO workspaces (name, local_root, host_id, remote_root, exclude_patterns, deploy_recipe, tab_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      name,
      localRoot,
      input.host_id,
      (input.remote_root ?? "/").trim() || "/",
      input.exclude_patterns ?? null,
      input.deploy_recipe ?? null,
      input.tab_id ?? null,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateWorkspace(
  id: number,
  input: Partial<WorkspaceInput>,
): Promise<void> {
  const db = await getDb();
  const cur = await getWorkspace(id);
  if (!cur) throw new Error("workspace not found");
  await db.execute(
    `UPDATE workspaces SET
      name = $1,
      local_root = $2,
      host_id = $3,
      remote_root = $4,
      exclude_patterns = $5,
      deploy_recipe = $6,
      tab_id = $7,
      updated_at = datetime('now')
     WHERE id = $8`,
    [
      (input.name ?? cur.name).trim(),
      (input.local_root ?? cur.local_root).trim(),
      input.host_id ?? cur.host_id,
      (input.remote_root ?? cur.remote_root).trim() || "/",
      input.exclude_patterns !== undefined
        ? input.exclude_patterns
        : cur.exclude_patterns,
      input.deploy_recipe !== undefined
        ? input.deploy_recipe
        : cur.deploy_recipe,
      input.tab_id !== undefined ? input.tab_id : cur.tab_id,
      id,
    ],
  );
}

export async function deleteWorkspace(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM workspaces WHERE id = $1", [id]);
}

export async function bindWorkspaceTab(
  id: number,
  tabId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE workspaces SET tab_id = $1, updated_at = datetime('now') WHERE id = $2",
    [tabId, id],
  );
}

export function parseExcludePatterns(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    /* fall through */
  }
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type DeployRecipeStep = {
  command?: string;
  script_id?: number;
};

export function parseDeployRecipe(
  raw: string | null | undefined,
): DeployRecipeStep[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as DeployRecipeStep[];
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { steps?: DeployRecipeStep[] };
      if (Array.isArray(obj.steps)) return obj.steps;
    }
  } catch {
    /* treat as shell lines */
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((command) => ({ command }));
}
