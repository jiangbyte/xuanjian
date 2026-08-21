import { getHost, touchHostConnected } from "./db";
import { api } from "./tauri";
import { useUiStore, type TermTab } from "../stores/ui";
import {
  endSessionRecording,
  startRecordingForOpenTab,
} from "./sessionRecorder";

export function canReconnect(tab: TermTab): boolean {
  if (tab.kind === "ssh") return tab.hostId != null;
  return true;
}

async function resolveShellId(tab: TermTab): Promise<string> {
  if (tab.shellId) return tab.shellId;
  const shells = await api.listLocalShells();
  const byName = shells.find(
    (s) => s.name === tab.title || s.id === tab.title,
  );
  if (byName) return byName.id;
  const def = shells.find((s) => s.isDefault) || shells[0];
  if (!def) throw new Error("No local shell available");
  return def.id;
}

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

/** Reconnect an existing tab in place (keeps scrollback). */
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
    const session = await api.localShellOpen(
      shellId,
      opts?.cols,
      opts?.rows,
    );
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

/** Mark tab closed when backend emits session-closed (no auto reconnect). */
export function handleSessionClosed(sessionId: string) {
  void endSessionRecording(sessionId, "closed");
  const { tabs, updateTab } = useUiStore.getState();
  const tab = tabs.find((t) => t.sessionId === sessionId);
  if (!tab) return;
  updateTab(tab.id, { status: "closed", sessionId: null });
}
