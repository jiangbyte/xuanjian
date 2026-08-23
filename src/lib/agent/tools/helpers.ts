/**
 * @file Agent 工具执行辅助
 * @author Charlie
 */

import { resolveFsEndpoint, type FsEndpoint } from "@/lib/fs";
import {
  ensureLocalShellTab,
  ensureSshTab,
  resolveDefaultWslShellId,
} from "@/lib/session/ensureSession";
import type { TermTab } from "@/stores/ui";
import { useUiStore } from "@/stores/ui";

/** 从工具参数解析 tab_id */
export function tabIdFromArgs(args: Record<string, unknown>): string | undefined {
  return typeof args.tab_id === "string" && args.tab_id.trim()
    ? args.tab_id.trim()
    : undefined;
}

export function shellIdFromArgs(
  args: Record<string, unknown>,
): string | undefined {
  return typeof args.shell_id === "string" && args.shell_id.trim()
    ? args.shell_id.trim()
    : undefined;
}

function planeFromArgs(args: Record<string, unknown>): string {
  return typeof args.plane === "string" ? args.plane.trim().toLowerCase() : "";
}

function hostIdFromArgs(args: Record<string, unknown>): number | undefined {
  return typeof args.host_id === "number" ? args.host_id : undefined;
}

/** 按 tab_id 或当前焦点解析终端标签（同步，不自动打开） */
export function resolveTab(tabId?: string | null): TermTab | null {
  const { tabs, activeTabId } = useUiStore.getState();
  if (tabId) {
    return tabs.find((t) => t.id === tabId) ?? null;
  }
  return tabs.find((t) => t.id === activeTabId) ?? null;
}

export type ResolvedExecutionTab = {
  tab: TermTab;
  /** 本次是否新建/重连了标签会话 */
  provisioned: boolean;
};

/**
 * 解析命令执行目标：tab_id > shell_id > plane > 当前焦点。
 * WSL/SSH 标签未打开时会自动后台创建并连接。
 */
export async function resolveTabForExecution(
  args: Record<string, unknown>,
): Promise<ResolvedExecutionTab | null> {
  const tabId = tabIdFromArgs(args);
  if (tabId) {
    const tab = resolveTab(tabId);
    if (!tab) return null;
    if (tab.sessionId && tab.status === "open") {
      return { tab, provisioned: false };
    }
    const shellId = tab.shellId;
    if (tab.kind === "local" && shellId) {
      return ensureLocalShellTab(shellId);
    }
    if (tab.kind === "ssh" && tab.hostId != null) {
      return ensureSshTab(tab.hostId);
    }
    return tab.sessionId ? { tab, provisioned: false } : null;
  }

  const shellId = shellIdFromArgs(args);
  if (shellId) {
    try {
      return await ensureLocalShellTab(shellId);
    } catch {
      return null;
    }
  }

  const plane = planeFromArgs(args);
  if (plane === "wsl") {
    const distro =
      typeof args.wsl_distro === "string" ? args.wsl_distro : undefined;
    const wslId = await resolveDefaultWslShellId(distro);
    if (!wslId) return null;
    try {
      return await ensureLocalShellTab(wslId);
    } catch {
      return null;
    }
  }
  if (plane === "ssh") {
    const hostId = hostIdFromArgs(args);
    if (hostId == null) return null;
    try {
      return await ensureSshTab(hostId);
    } catch {
      return null;
    }
  }

  const tab = resolveTab();
  if (!tab) return null;
  if (tab.sessionId && tab.status === "open") {
    return { tab, provisioned: false };
  }
  if (tab.kind === "local" && tab.shellId) {
    try {
      return await ensureLocalShellTab(tab.shellId);
    } catch {
      return null;
    }
  }
  if (tab.kind === "ssh" && tab.hostId != null) {
    try {
      return await ensureSshTab(tab.hostId);
    } catch {
      return null;
    }
  }
  return tab.sessionId ? { tab, provisioned: false } : null;
}

export function formatResolveError(
  args: Record<string, unknown>,
  fallback = "No active session",
): string {
  const tabId = tabIdFromArgs(args);
  if (tabId) return `No session for tab_id=${tabId}`;
  const shellId = shellIdFromArgs(args);
  if (shellId) return `Cannot open shell_id=${shellId}`;
  const plane = planeFromArgs(args);
  if (plane === "wsl") return "No WSL distro available";
  if (plane === "ssh") return "host_id required when plane=ssh";
  return fallback;
}

export async function activeSessionIdAsync(
  args: Record<string, unknown>,
): Promise<{ sessionId: string; tab: TermTab; provisioned: boolean } | null> {
  if (typeof args.session_id === "string" && args.session_id.trim()) {
    const tab =
      resolveTab(tabIdFromArgs(args)) ??
      useUiStore.getState().tabs.find((t) => t.sessionId === args.session_id) ??
      null;
    return {
      sessionId: args.session_id.trim(),
      tab: tab ?? {
        id: "",
        title: "",
        kind: "local",
        sessionId: args.session_id.trim(),
        status: "open",
      },
      provisioned: false,
    };
  }
  const resolved = await resolveTabForExecution(args);
  if (!resolved?.tab.sessionId) return null;
  return {
    sessionId: resolved.tab.sessionId,
    tab: resolved.tab,
    provisioned: resolved.provisioned,
  };
}

export function activeSessionId(
  explicitSessionId?: string,
  tabId?: string,
): string | null {
  if (explicitSessionId) return explicitSessionId;
  return resolveTab(tabId)?.sessionId ?? null;
}

export function activeTabHostId(tabId?: string): number | undefined {
  return resolveTab(tabId)?.hostId ?? undefined;
}

export function activeFsEndpoint(tabId?: string): FsEndpoint | null {
  return resolveFsEndpoint(resolveTab(tabId));
}

export async function activeFsEndpointAsync(
  args: Record<string, unknown>,
): Promise<{ endpoint: FsEndpoint; tab: TermTab; provisioned: boolean } | null> {
  const resolved = await resolveTabForExecution(args);
  if (!resolved) return null;
  const endpoint = resolveFsEndpoint(resolved.tab);
  if (!endpoint) return null;
  return {
    endpoint,
    tab: resolved.tab,
    provisioned: resolved.provisioned,
  };
}
