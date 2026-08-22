/**
 * @file Agent 工具执行辅助
 * @author Charlie
 */

import { resolveFsEndpoint, type FsEndpoint } from "@/lib/fs";
import type { TermTab } from "@/stores/ui";
import { useUiStore } from "@/stores/ui";

/** 从工具参数解析 tab_id */
export function tabIdFromArgs(args: Record<string, unknown>): string | undefined {
  return typeof args.tab_id === "string" && args.tab_id.trim()
    ? args.tab_id.trim()
    : undefined;
}

/** 按 tab_id 或当前焦点解析终端标签 */
export function resolveTab(tabId?: string | null): TermTab | null {
  const { tabs, activeTabId } = useUiStore.getState();
  if (tabId) {
    return tabs.find((t) => t.id === tabId) ?? null;
  }
  return tabs.find((t) => t.id === activeTabId) ?? null;
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
