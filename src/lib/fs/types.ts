/**
 * @file 文件系统端点类型
 * @author Charlie
 */

import type { TermTab } from "@/stores/ui";

export type FsKind = "local" | "sftp" | "wsl";

export type FsEndpoint = {
  kind: FsKind;
  sessionId: string | null;
  unixPaths: boolean;
  shellId?: string | null;
  hostId?: number | null;
};

/** 从终端标签解析文件操作端点 */
export function resolveFsEndpoint(tab: TermTab | null): FsEndpoint | null {
  if (!tab) return null;
  if (tab.kind === "ssh") {
    return {
      kind: "sftp",
      sessionId: tab.sessionId,
      unixPaths: true,
      hostId: tab.hostId ?? null,
    };
  }
  if (tab.shellId?.startsWith("local:wsl:")) {
    return {
      kind: "wsl",
      sessionId: tab.sessionId,
      unixPaths: true,
      shellId: tab.shellId,
    };
  }
  return {
    kind: "local",
    sessionId: null,
    unixPaths: false,
    shellId: tab.shellId ?? null,
  };
}
