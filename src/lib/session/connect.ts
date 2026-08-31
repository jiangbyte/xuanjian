/**
 * @file 会话连接与标签重连
 * @author Charlie
 * @description 打开 SSH / 本地 Shell、就地重连终端标签（保留回滚缓冲），
 * 以及处理后端 session-closed 事件时的标签状态更新。
 */

import { addKnownHost, getHost, HostRow, touchHostConnected } from "@/lib/db";
import { dialogs } from "@/lib/ui/dialogs";
import i18n from "@/i18n";
import {
  endSessionRecording,
  startRecordingForOpenTab,
} from "@/lib/session/recorder";
import { api, type LocalShellInfo, type SessionInfo, type SshConnectParams } from "@/lib/tauri";
import { type AgentTermTab, type TermTab, useUiStore } from "@/stores/ui";

export const SSH_HOST_KEY_UNKNOWN = "SSH_HOST_KEY_UNKNOWN";
export const SSH_HOST_KEY_MISMATCH = "SSH_HOST_KEY_MISMATCH";

/** 判断标签是否具备重连所需信息（SSH / Agent-SSH 需有 hostId；本地与 WSL 均可） */
export function canReconnect(tab: TermTab): boolean {
  if (tab.kind === "ssh") return tab.hostId != null;
  // local（含 WSL）：有 shellId 或可回退到默认本地 Shell
  return true;
}

function buildSshConnectParams(
  host: HostRow,
  opts?: { cols?: number; rows?: number },
): SshConnectParams {
  return {
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
    proxyType: host.proxy_type ?? null,
    proxyHost: host.proxy_host ?? null,
    proxyPort: host.proxy_port ?? null,
    jumpHostId: host.jump_host_id ?? null,
  };
}

function parseHostKeyError(
  message: string,
):
  | { kind: "unknown"; host: string; port: number; fingerprint: string }
  | { kind: "mismatch"; host: string; port: number; detail: string }
  | null {
  if (message.includes(`${SSH_HOST_KEY_UNKNOWN}:`)) {
    const idx = message.indexOf(`${SSH_HOST_KEY_UNKNOWN}:`);
    const rest = message.slice(idx + SSH_HOST_KEY_UNKNOWN.length + 1);
    const [host, portRaw, ...fpParts] = rest.split(":");
    const port = Number(portRaw);
    const fingerprint = fpParts.join(":");
    if (!host || !Number.isFinite(port) || !fingerprint) return null;
    return { kind: "unknown", host, port, fingerprint };
  }
  if (message.includes(`${SSH_HOST_KEY_MISMATCH}:`)) {
    const idx = message.indexOf(`${SSH_HOST_KEY_MISMATCH}:`);
    const rest = message.slice(idx + SSH_HOST_KEY_MISMATCH.length + 1);
    const [host, portRaw, ...detailParts] = rest.split(":");
    const port = Number(portRaw);
    const detail = detailParts.join(":");
    if (!host || !Number.isFinite(port)) return null;
    return { kind: "mismatch", host, port, detail };
  }
  return null;
}

async function sshConnectWithHostKeyTrust(
  host: HostRow,
  opts?: { cols?: number; rows?: number },
) {
  return sshConnectWithTrust(buildSshConnectParams(host, opts));
}

/** SSH 连接；未知主机密钥时弹窗确认并写入 known_hosts */
export async function sshConnectWithTrust(
  params: SshConnectParams,
): Promise<SessionInfo> {
  try {
    return await api.sshConnect(params);
  } catch (e) {
    const msg = String(e);
    const parsed = parseHostKeyError(msg);
    if (parsed?.kind === "mismatch") {
      throw new Error(
        `${i18n.t("hosts.hostKeyMismatch")} (${parsed.host}:${parsed.port})`,
      );
    }
    if (parsed?.kind === "unknown") {
      const ok = await dialogs.hostKeyTrust({
        host: parsed.host,
        port: parsed.port,
        fingerprint: parsed.fingerprint,
      });
      if (!ok) throw e;
      await addKnownHost(parsed.host, parsed.port, parsed.fingerprint);
      return api.sshConnect(params);
    }
    throw e;
  }
}

async function writePostConnectCommands(sessionId: string, host: HostRow) {
  if (host.remote_path?.trim()) {
    await api.sessionWrite(sessionId, `cd ${host.remote_path.trim()}\n`);
  }
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
 * 默认会在连接后 cd 到 remote_path 并写入 startup_cmd（可用 runStartup: false 跳过）。
 */
export async function connectSshHost(
  hostId: number,
  opts?: { cols?: number; rows?: number; runStartup?: boolean },
) {
  const host = await getHost(hostId);
  if (!host) throw new Error(`Host #${hostId} not found`);
  const session = await sshConnectWithHostKeyTrust(host, opts);
  await touchHostConnected(host.id);
  await writePostConnectCommands(session.id, host);
  if (opts?.runStartup !== false && host.startup_cmd?.trim()) {
    await api.sessionWrite(session.id, `${host.startup_cmd.trim()}\n`);
  }
  return { session, host };
}

/** 打开本地 Shell 标签并建立会话 */
export async function connectLocalShell(
  shell: LocalShellInfo,
): Promise<{ session: SessionInfo; tabId: string }> {
  const tabId = crypto.randomUUID();
  const { addTab, updateTab } = useUiStore.getState();
  addTab({
    id: tabId,
    title: shell.name,
    kind: "local",
    sessionId: null,
    shellId: shell.id,
    status: "connecting",
  });
  try {
    const session = await api.localShellOpen(shell.id);
    const recording = startRecordingForOpenTab(tabId, session.id);
    updateTab(tabId, {
      sessionId: session.id,
      status: "open",
      title: session.title,
      shellId: shell.id,
    });
    await recording;
    return { session, tabId };
  } catch (e) {
    updateTab(tabId, { status: "error" });
    throw e;
  }
}

/**
 * 就地重连已有标签（保留滚动回滚缓冲）。
 * 支持主标签与 Agent 下栏；SSH / 本地 / WSL 统一走此入口。
 * 会先结束旧会话录制并关闭旧 session，再开新会话并启动录制。
 */
export async function reconnectTermTab(
  tabId: string,
  opts?: { cols?: number; rows?: number },
): Promise<void> {
  const { tabs, agentTabs, updateTab } = useUiStore.getState();
  const agentTab = agentTabs.find((t) => t.id === tabId);
  if (agentTab) {
    await reconnectAgentTermTab(agentTab, opts);
    return;
  }

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

/** Agent 下栏就地重连（与主标签同一套 SSH / 本地 / WSL 逻辑） */
async function reconnectAgentTermTab(
  agentTab: AgentTermTab,
  opts?: { cols?: number; rows?: number },
): Promise<void> {
  const { tabs, updateAgentTab } = useUiStore.getState();
  if (agentTab.status === "connecting") return;

  const probe: TermTab = {
    id: agentTab.id,
    title: agentTab.title,
    kind: agentTab.kind,
    sessionId: agentTab.sessionId,
    hostId: agentTab.hostId,
    shellId: agentTab.shellId,
    logId: agentTab.logId,
    status: agentTab.status,
  };
  if (!canReconnect(probe)) {
    throw new Error("Cannot reconnect: missing host or shell info");
  }

  if (agentTab.sessionId) {
    await endSessionRecording(agentTab.sessionId, "closed");
    await api.sessionClose(agentTab.sessionId).catch(() => undefined);
  }

  updateAgentTab(agentTab.id, {
    status: "connecting",
    sessionId: null,
    logId: undefined,
  });

  try {
    if (agentTab.kind === "ssh") {
      const { session } = await connectSshHost(agentTab.hostId!, {
        cols: opts?.cols,
        rows: opts?.rows,
        runStartup: false,
      });
      const recording = startRecordingForOpenTab(agentTab.id, session.id);
      updateAgentTab(agentTab.id, {
        sessionId: session.id,
        status: "open",
      });
      await recording;
      return;
    }

    let shellId = agentTab.shellId;
    if (!shellId) {
      const parent = tabs.find((t) => t.id === agentTab.parentTabId);
      shellId = parent
        ? await resolveShellId(parent)
        : await resolveShellId(probe);
    }
    const session = await api.localShellOpen(shellId, opts?.cols, opts?.rows);
    const recording = startRecordingForOpenTab(agentTab.id, session.id);
    updateAgentTab(agentTab.id, {
      sessionId: session.id,
      status: "open",
      shellId,
    });
    await recording;
  } catch (e) {
    updateAgentTab(agentTab.id, { status: "error", sessionId: null });
    throw e;
  }
}

/**
 * 后端发出 session-closed 时标记标签已关闭（不自动重连）。
 */
export function handleSessionClosed(sessionId: string) {
  void endSessionRecording(sessionId, "closed");
  const { tabs, agentTabs, updateTab, updateAgentTab } = useUiStore.getState();
  const agentTab = agentTabs.find((t) => t.sessionId === sessionId);
  if (agentTab) {
    updateAgentTab(agentTab.id, { status: "closed", sessionId: null });
    return;
  }
  const tab = tabs.find((t) => t.sessionId === sessionId);
  if (!tab) return;
  updateTab(tab.id, { status: "closed", sessionId: null });
}
