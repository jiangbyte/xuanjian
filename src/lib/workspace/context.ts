/**
 * @file 工作空间上下文解析
 * @author Charlie
 */

import {
  findWorkspaceByTabId,
  findWorkspacesByHostId,
  getWorkspace,
  type WorkspaceRow,
} from "@/lib/db/workspaces";
import { resolveFsEndpoint, type FsEndpoint } from "@/lib/fs";
import { useUiStore } from "@/stores/ui";

const ACTIVE_WS_KEY = "xuanjian.activeWorkspaceId";

export function getActiveWorkspaceId(): number | null {
  try {
    const v = localStorage.getItem(ACTIVE_WS_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setActiveWorkspaceId(id: number | null) {
  try {
    if (id == null) localStorage.removeItem(ACTIVE_WS_KEY);
    else localStorage.setItem(ACTIVE_WS_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export async function resolveActiveWorkspace(
  explicitId?: number | null,
): Promise<WorkspaceRow | null> {
  const id = explicitId ?? getActiveWorkspaceId();
  if (id != null) {
    const ws = await getWorkspace(id);
    if (ws) return ws;
  }
  const { tabs, activeTabId } = useUiStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId) ?? null;
  if (!tab) return null;
  const byTab = await findWorkspaceByTabId(tab.id);
  if (byTab) return byTab;
  if (tab.hostId != null) {
    const list = await findWorkspacesByHostId(tab.hostId);
    if (list.length === 1) return list[0];
  }
  return null;
}

export function resolveWorkspaceFsEndpoint(
  ws: WorkspaceRow,
): FsEndpoint | null {
  const { tabs, activeTabId } = useUiStore.getState();
  const tab =
    (ws.tab_id ? tabs.find((t) => t.id === ws.tab_id) : null) ??
    tabs.find((t) => t.id === activeTabId && t.hostId === ws.host_id) ??
    tabs.find((t) => t.hostId === ws.host_id && t.sessionId) ??
    null;
  return resolveFsEndpoint(tab);
}

export function resolveWorkspaceSessionId(ws: WorkspaceRow): string | null {
  const ep = resolveWorkspaceFsEndpoint(ws);
  return ep?.sessionId ?? null;
}
