/**
 * @file 会话连接与标签重连
 * @author Charlie
 * @description 打开 SSH / 本地 Shell、就地重连终端标签（保留回滚缓冲），
 * 以及处理后端 session-closed 事件时的标签状态更新。
 */

import { getHost, touchHostConnected } from "@/lib/db";
import { api } from "@/lib/tauri";
import { useUiStore, type TermTab } from "@/stores/ui";
import {
  endSessionRecording,
  startRecordingForOpenTab,
} from "@/lib/sessionRecorder";

/** 判断标签是否具备重连所需信息（SSH 需有 hostId） */
export function canReconnect(tab: TermTab): boolean {
  if (tab.kind === "ssh") return tab.hostId != null;
  return true;
}

async function resolveShellId(tab: TermTab): Promise<string> {
  if (tab.shellId) return tab.shellId;
  const shells = await api.listLocalShells();
  const byName = shells.find((s) => s.name === tab.title || s.id === tab.title);
  if (byName) return byName.id;
  const def = shells.find((s) => s.isDefault) || shells[0];
  if (!def) throw new Error("No local shell available");
  return def.id;
}

/**
 * 按主机记录建立 SSH 会话。
 * 默认会在连接后写入 startup_cmd（可用 runStartup: false 跳过）。
 */
export async function connectSshHost(
  hostId: number,
  opts?: { cols?: number; rows?: number; runStartup?: boolean },
) {
  const host = await getHost(hostId);
  if (!host) throw new Error(`Host #${hostId} not found`);
  const session = await api.sshConnect({
    host: host.host,
    port: host.port,
    username: host.username,
    authType: host.auth_type === "private_key" ? "privateKey" : host.auth_type,
    password: host.password_enc,
    privateKeyPath: host.private_key_path,
    passphrase: host.passphrase_enc,
    title: host.name,
    terminalType: host.terminal_type,
    cols: opts?.cols,
    rows: opts?.rows,
  });
  await touchHostConnected(host.id);
  if (opts?.runStartup !== false && host.startup_cmd?.trim()) {
    await api.sessionWrite(session.id, `${host.startup_cmd.trim()}\n`);
  }
  return { session, host };
}

/**
 * 就地重连已有标签（保留滚动回滚缓冲）。
 * 会先结束旧会话录制并关闭旧 session，再开新会话并启动录制。
 */
export async function reconnectTermTab(
  tabId: string,
  opts?: { cols?: number; rows?: number },
): Promise<void> {
  const { tabs, updateTab } = useUiStore.getState();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.status === "connecting") return;
  if (!canReconnect(tab)) {
    throw new Error("Cannot reconnect: missing host or shell info");
  }

  if (tab.sessionId) {
    await endSessionRecording(tab.sessionId, "closed");
    await api.sessionClose(tab.sessionId).catch(() => undefined);
  }

  updateTab(tabId, { status: "connecting", sessionId: null, logId: undefined });

  try {
    if (tab.kind === "ssh") {
      const { session, host } = await connectSshHost(tab.hostId!, {
        cols: opts?.cols,
        rows: opts?.rows,
        runStartup: false,
      });
      const recording = startRecordingForOpenTab(tabId, session.id);
      updateTab(tabId, {
        sessionId: session.id,
        status: "open",
        title: session.title || tab.title,
      });
      await recording;
      if (host.startup_cmd?.trim()) {
        await api.sessionWrite(session.id, `${host.startup_cmd.trim()}\n`);
      }
      return;
    }

    const shellId = await resolveShellId(tab);
    const session = await api.localShellOpen(shellId, opts?.cols, opts?.rows);
    const recording = startRecordingForOpenTab(tabId, session.id);
    updateTab(tabId, {
      sessionId: session.id,
      status: "open",
      title: session.title || tab.title,
      shellId,
    });
    await recording;
  } catch (e) {
    updateTab(tabId, { status: "error", sessionId: null });
    throw e;
  }
}

/**
 * 后端发出 session-closed 时标记标签已关闭（不自动重连）。
 */
export function handleSessionClosed(sessionId: string) {
  void endSessionRecording(sessionId, "closed");
  const { tabs, updateTab } = useUiStore.getState();
  const tab = tabs.find((t) => t.sessionId === sessionId);
  if (!tab) return;
  updateTab(tab.id, { status: "closed", sessionId: null });
}
