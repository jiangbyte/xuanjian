/**
 * @file 文件浏览器 cwd：仅在切换标签时初始化，避免上传/刷新跳目录
 * @author Charlie
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getHost } from "@/lib/db";
import { api } from "@/lib/tauri";

export type CwdSessionKind = "local" | "ssh" | null;

function tabIdentity(
  kind: CwdSessionKind,
  hostId?: number | null,
  shellId?: string | null,
) {
  return `${kind ?? "none"}:${hostId ?? ""}:${shellId ?? ""}`;
}

/** 管理 cwd / pathInput，sessionId 就绪时只初始化一次 */
export function useCwdState(opts: {
  kind: CwdSessionKind;
  sessionId: string | null;
  hostId?: number | null;
  shellId?: string | null;
  wslMode: boolean;
  tabId?: string;
}) {
  const { kind, sessionId, hostId, shellId, wslMode, tabId } = opts;
  const [cwd, setCwd] = useState("");
  const [pathInput, setPathInput] = useState("");
  const identityRef = useRef("");
  const cwdReadyRef = useRef(false);

  const resetForTab = useCallback(() => {
    cwdReadyRef.current = false;
    setCwd("");
    setPathInput("");
  }, []);

  useEffect(() => {
    const id = `${tabId ?? ""}:${tabIdentity(kind, hostId, shellId)}`;
    if (id !== identityRef.current) {
      identityRef.current = id;
      resetForTab();
    }
  }, [kind, hostId, shellId, tabId, resetForTab]);

  useEffect(() => {
    if (cwdReadyRef.current) return;

    if (wslMode) {
      if (!sessionId) return;
      cwdReadyRef.current = true;
      void api.wslHomeDir(sessionId).then((home) => {
        setCwd(home);
        setPathInput(home);
      });
      return;
    }

    if (kind === "ssh") {
      if (!sessionId) return;
      cwdReadyRef.current = true;
      void (async () => {
        if (hostId != null) {
          const host = await getHost(hostId);
          const remotePath = host?.remote_path?.trim();
          if (remotePath) {
            setCwd(remotePath);
            setPathInput(remotePath);
            return;
          }
        }
        setCwd("/");
        setPathInput("/");
      })();
      return;
    }

    if (kind === "local") {
      cwdReadyRef.current = true;
      void api.getHomeDir().then((home) => {
        setCwd(home);
        setPathInput(home);
      });
    }
  }, [kind, wslMode, sessionId, hostId]);

  const commitPath = useCallback((path: string) => {
    const next = path.trim();
    if (!next) return;
    setCwd(next);
    setPathInput(next);
  }, []);

  useEffect(() => {
    if (cwd) setPathInput(cwd);
  }, [cwd]);

  return {
    cwd,
    setCwd,
    pathInput,
    setPathInput,
    commitPath,
  };
}
