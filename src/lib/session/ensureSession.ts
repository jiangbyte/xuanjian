/**
 * @file 按需打开本地 Shell / SSH 标签（Agent 用，无需用户预先打开 WSL 等）
 * @author Charlie
 */

import { getHost, type HostRow } from "@/lib/db";
import { connectSshHost } from "@/lib/session/connect";
import { startRecordingForOpenTab } from "@/lib/session/recorder";
import { api, type LocalShellInfo } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings";
import { type TermTab, useUiStore } from "@/stores/ui";

export type EnsureTabResult = {
  tab: TermTab;
  /** 本次调用是否新建或重连了会话 */
  provisioned: boolean;
};

function freshTab(tabId: string): TermTab | null {
  return useUiStore.getState().tabs.find((t) => t.id === tabId) ?? null;
}

/** 查找已就绪的本地 Shell 标签 */
export function findOpenLocalShellTab(shellId: string): TermTab | null {
  const { tabs } = useUiStore.getState();
  return (
    tabs.find(
      (t) =>
        t.kind === "local" &&
        t.shellId === shellId &&
        t.status === "open" &&
        t.sessionId,
    ) ?? null
  );
}

/** 查找已就绪的 SSH 标签 */
export function findOpenSshTab(hostId: number): TermTab | null {
  const { tabs } = useUiStore.getState();
  return (
    tabs.find(
      (t) =>
        t.kind === "ssh" &&
        t.hostId === hostId &&
        t.status === "open" &&
        t.sessionId,
    ) ?? null
  );
}

async function openLocalShellTab(
  shell: LocalShellInfo,
  opts?: { activate?: boolean },
): Promise<EnsureTabResult> {
  const { tabs, addTab, updateTab, setActiveTab } = useUiStore.getState();

  const stale = tabs.find(
    (t) => t.kind === "local" && t.shellId === shell.id,
  );
  if (stale?.status === "open" && stale.sessionId) {
    if (opts?.activate) setActiveTab(stale.id);
    return { tab: stale, provisioned: false };
  }

  const tabId = stale?.id ?? crypto.randomUUID();
  if (!stale) {
    addTab({
      id: tabId,
      title: shell.name,
      kind: "local",
      sessionId: null,
      shellId: shell.id,
      status: "connecting",
    });
  } else {
    updateTab(tabId, { status: "connecting", sessionId: null });
  }
  if (opts?.activate) setActiveTab(tabId);

  const session = await api.localShellOpen(shell.id);
  const recording = startRecordingForOpenTab(tabId, session.id);
  updateTab(tabId, {
    sessionId: session.id,
    status: "open",
    title: session.title || shell.name,
    shellId: shell.id,
  });
  await recording;

  const tab = freshTab(tabId);
  if (!tab) throw new Error("Failed to open local shell tab");
  return { tab, provisioned: true };
}

async function openSshTab(
  host: HostRow,
  opts?: { activate?: boolean },
): Promise<EnsureTabResult> {
  const { tabs, addTab, updateTab, setActiveTab } = useUiStore.getState();

  const stale = tabs.find(
    (t) => t.kind === "ssh" && t.hostId === host.id,
  );
  if (stale?.status === "open" && stale.sessionId) {
    if (opts?.activate) setActiveTab(stale.id);
    return { tab: stale, provisioned: false };
  }

  const tabId = stale?.id ?? crypto.randomUUID();
  if (!stale) {
    addTab({
      id: tabId,
      title: host.name || host.host,
      kind: "ssh",
      sessionId: null,
      hostId: host.id,
      status: "connecting",
    });
  } else {
    updateTab(tabId, { status: "connecting", sessionId: null });
  }
  if (opts?.activate) setActiveTab(tabId);

  const { session } = await connectSshHost(host.id);
  const recording = startRecordingForOpenTab(tabId, session.id);
  updateTab(tabId, {
    sessionId: session.id,
    status: "open",
    title: session.title || host.name || host.host,
  });
  await recording;

  const tab = freshTab(tabId);
  if (!tab) throw new Error("Failed to open SSH tab");
  return { tab, provisioned: true };
}

/** 确保本地 Shell（含 WSL）标签已连接；无标签时后台自动创建 */
export async function ensureLocalShellTab(
  shellId: string,
  opts?: { activate?: boolean },
): Promise<EnsureTabResult> {
  const hit = findOpenLocalShellTab(shellId);
  if (hit) {
    if (opts?.activate) useUiStore.getState().setActiveTab(hit.id);
    return { tab: hit, provisioned: false };
  }
  const shells = await api.listLocalShells();
  const shell = shells.find((s) => s.id === shellId);
  if (!shell) throw new Error(`Shell not found: ${shellId}`);
  return openLocalShellTab(shell, opts);
}

/** 确保 SSH 标签已连接 */
export async function ensureSshTab(
  hostId: number,
  opts?: { activate?: boolean },
): Promise<EnsureTabResult> {
  const hit = findOpenSshTab(hostId);
  if (hit) {
    if (opts?.activate) useUiStore.getState().setActiveTab(hit.id);
    return { tab: hit, provisioned: false };
  }
  const host = await getHost(hostId);
  if (!host) throw new Error(`Host #${hostId} not found`);
  return openSshTab(host, opts);
}

/** 解析默认 WSL shell_id */
export async function resolveDefaultWslShellId(
  distro?: string | null,
): Promise<string | null> {
  const shells = await api.listLocalShells();
  const wsl = shells.filter((s) => s.id.startsWith("local:wsl:"));
  if (!wsl.length) return null;

  const trimmed = distro?.trim();
  if (trimmed) {
    const exact = wsl.find(
      (s) =>
        s.id === `local:wsl:${trimmed}` ||
        s.name.toLowerCase().includes(trimmed.toLowerCase()),
    );
    if (exact) return exact.id;
  }

  const pref = useSettingsStore.getState().defaultLocalShell;
  if (pref.startsWith("local:wsl:")) {
    const hit = wsl.find((s) => s.id === pref);
    if (hit) return hit.id;
  }

  return wsl.find((s) => s.isDefault)?.id ?? wsl[0]?.id ?? null;
}
