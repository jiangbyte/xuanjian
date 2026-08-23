/**
 * @file Agent 工具执行辅助
 * @author Charlie
 */

import { resolveFsEndpoint, type FsEndpoint } from "@/lib/fs";
import {
  reconnectLocalShellTabInPlace,
  reconnectSshTabInPlace,
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

function activeTabOrNull(): TermTab | null {
  const { activeTabId } = useUiStore.getState();
  if (!activeTabId) return null;
  return resolveTab(activeTabId);
}

/** 校验 shell_id / plane 是否与当前焦点标签一致（禁止跨标签路由） */
function validatePlaneArgsAgainstTab(
  args: Record<string, unknown>,
  tab: TermTab,
): string | null {
  const shellId = shellIdFromArgs(args);
  if (shellId && tab.shellId !== shellId) {
    return `shell_id=${shellId} 与当前标签 (${tab.shellId ?? "无"}) 不一致；禁止自动打开其他 Shell/WSL 标签`;
  }

  const plane = planeFromArgs(args);
  if (plane === "wsl") {
    if (!tab.shellId?.startsWith("local:wsl:")) {
      return "plane=wsl 但当前标签不是 WSL；请切换到 WSL 终端标签后执行";
    }
    const distro =
      typeof args.wsl_distro === "string" ? args.wsl_distro.trim() : "";
    if (distro) {
      const sid = tab.shellId.replace(/^local:wsl:/, "");
      if (
        sid.toLowerCase() !== distro.toLowerCase() &&
        !tab.title.toLowerCase().includes(distro.toLowerCase())
      ) {
        return `wsl_distro=${distro} 与当前 WSL 标签 (${sid}) 不一致`;
      }
    }
  }
  if (plane === "ssh") {
    if (tab.kind !== "ssh") {
      return "plane=ssh 但当前标签不是 SSH；请切换到 SSH 终端标签后执行";
    }
    const hostId = hostIdFromArgs(args);
    if (hostId != null && tab.hostId !== hostId) {
      return `host_id=${hostId} 与当前 SSH 标签 (hostId=${tab.hostId}) 不一致`;
    }
  }
  return null;
}

let lastResolveError: string | null = null;

export function takeLastResolveError(): string | null {
  const msg = lastResolveError;
  lastResolveError = null;
  return msg;
}

/**
 * 解析命令执行目标：仅使用当前焦点标签。
 * 禁止跨标签、禁止自动新建 WSL/SSH 标签。
 */
export async function resolveTabForExecution(
  args: Record<string, unknown>,
): Promise<ResolvedExecutionTab | null> {
  lastResolveError = null;
  const { activeTabId } = useUiStore.getState();
  const reqTabId = tabIdFromArgs(args);

  if (!activeTabId) {
    lastResolveError = "无当前焦点终端标签";
    return null;
  }
  if (reqTabId && reqTabId !== activeTabId) {
    lastResolveError =
      "禁止跨标签操作：tab_id 必须对应当前焦点标签，或省略 tab_id";
    return null;
  }

  const tab = activeTabOrNull();
  if (!tab) {
    lastResolveError = "当前焦点标签不存在";
    return null;
  }

  const planeErr = validatePlaneArgsAgainstTab(args, tab);
  if (planeErr) {
    lastResolveError = planeErr;
    return null;
  }

  if (tab.sessionId && tab.status === "open") {
    return { tab, provisioned: false };
  }

  if (tab.kind === "local" && tab.shellId) {
    try {
      return await reconnectLocalShellTabInPlace(tab);
    } catch (e) {
      lastResolveError = String(e);
      return null;
    }
  }
  if (tab.kind === "ssh" && tab.hostId != null) {
    try {
      return await reconnectSshTabInPlace(tab);
    } catch (e) {
      lastResolveError = String(e);
      return null;
    }
  }

  if (!tab.sessionId) {
    lastResolveError = "当前标签未连接，请先在终端中连接会话";
  }
  return tab.sessionId ? { tab, provisioned: false } : null;
}

export function formatResolveError(
  _args: Record<string, unknown>,
  fallback = "No active session",
): string {
  return takeLastResolveError() ?? fallback;
}

export async function activeSessionIdAsync(
  args: Record<string, unknown>,
): Promise<{ sessionId: string; tab: TermTab; provisioned: boolean } | null> {
  if (typeof args.session_id === "string" && args.session_id.trim()) {
    const tab = activeTabOrNull();
    if (!tab?.sessionId || tab.sessionId !== args.session_id.trim()) {
      lastResolveError =
        "session_id 与当前焦点标签会话不一致；禁止跨标签使用 session";
      return null;
    }
    return {
      sessionId: args.session_id.trim(),
      tab,
      provisioned: false,
    };
  }
  const resolved = await resolveTabForExecution(args);
  if (!resolved?.tab.sessionId) return null;
  return {
    sessionId: resolved.tab.sessionId,
    tab: resolved.tab,
    provisioned: false,
  };
}

export function activeSessionId(
  explicitSessionId?: string,
  tabId?: string,
): string | null {
  const { activeTabId } = useUiStore.getState();
  if (tabId && activeTabId && tabId !== activeTabId) return null;
  const tab = resolveTab(activeTabId);
  if (explicitSessionId) {
    if (!tab?.sessionId || tab.sessionId !== explicitSessionId) return null;
    return explicitSessionId;
  }
  return tab?.sessionId ?? null;
}

export function activeTabHostId(tabId?: string): number | undefined {
  const { activeTabId } = useUiStore.getState();
  if (tabId && activeTabId && tabId !== activeTabId) return undefined;
  return resolveTab(activeTabId)?.hostId ?? undefined;
}

export function activeFsEndpoint(tabId?: string): FsEndpoint | null {
  const { activeTabId } = useUiStore.getState();
  if (tabId && activeTabId && tabId !== activeTabId) return null;
  return resolveFsEndpoint(resolveTab(activeTabId));
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
    provisioned: false,
  };
}
