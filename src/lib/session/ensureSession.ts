/**
 * @file 解析已有终端标签并就地重连（禁止自动新建标签）
 * @author Charlie
 */

import { getHost } from "@/lib/db";
import { connectSshHost } from "@/lib/session/connect";
import { startRecordingForOpenTab } from "@/lib/session/recorder";
import { api, type LocalShellInfo } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings";
import { type TermTab, useUiStore } from "@/stores/ui";

export type EnsureTabResult = {
  tab: TermTab;
  /** 保留字段；始终为 false（不再自动新建标签） */
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

/** 查找任意本地 Shell 标签（含已断开） */
export function findLocalShellTab(shellId: string): TermTab | null {
  const { tabs } = useUiStore.getState();
  return (
    tabs.find((t) => t.kind === "local" && t.shellId === shellId) ?? null
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

/** 查找任意 SSH 标签（含已断开） */
export function findSshTab(hostId: number): TermTab | null {
  const { tabs } = useUiStore.getState();
  return (
    tabs.find((t) => t.kind === "ssh" && t.hostId === hostId) ?? null
  );
}

function tabNotOpenError(shell: LocalShellInfo): string {
  return `请先在终端中手动打开 Shell 标签：${shell.name}（${shell.id}）`;
}

function sshTabNotOpenError(hostId: number, label: string): string {
  return `请先在终端中手动打开 SSH 标签：${label}（host_id=${hostId}）`;
}

/** 在当前标签内重连本地 Shell（含 WSL），绝不新建或切换标签 */
export async function reconnectLocalShellTabInPlace(
  tab: TermTab,
): Promise<EnsureTabResult> {
  if (tab.kind !== "local" || !tab.shellId) {
    throw new Error("Not a local shell tab");
  }
  if (tab.sessionId && tab.status === "open") {
    return { tab, provisioned: false };
  }
  const shells = await api.listLocalShells();
  const shell = shells.find((s) => s.id === tab.shellId);
  if (!shell) throw new Error(`Shell not found: ${tab.shellId}`);

  const { updateTab } = useUiStore.getState();
  updateTab(tab.id, { status: "connecting", sessionId: null });
  const session = await api.localShellOpen(shell.id);
  const recording = startRecordingForOpenTab(tab.id, session.id);
  updateTab(tab.id, {
    sessionId: session.id,
    status: "open",
    title: session.title || shell.name,
    shellId: shell.id,
  });
  await recording;

  const fresh = freshTab(tab.id);
  if (!fresh) throw new Error("Failed to reconnect local shell tab");
  return { tab: fresh, provisioned: false };
}

/** 在当前标签内重连 SSH，绝不新建或切换标签 */
export async function reconnectSshTabInPlace(
  tab: TermTab,
): Promise<EnsureTabResult> {
  if (tab.kind !== "ssh" || tab.hostId == null) {
    throw new Error("Not an SSH tab");
  }
  if (tab.sessionId && tab.status === "open") {
    return { tab, provisioned: false };
  }
  const host = await getHost(tab.hostId);
  if (!host) throw new Error(`Host #${tab.hostId} not found`);

  const { updateTab } = useUiStore.getState();
  updateTab(tab.id, { status: "connecting", sessionId: null });
  const { session } = await connectSshHost(host.id);
  const recording = startRecordingForOpenTab(tab.id, session.id);
  updateTab(tab.id, {
    sessionId: session.id,
    status: "open",
    title: session.title || host.name || host.host,
  });
  await recording;

  const fresh = freshTab(tab.id);
  if (!fresh) throw new Error("Failed to reconnect SSH tab");
  return { tab: fresh, provisioned: false };
}

/**
 * 使用已有本地 Shell / WSL 标签；无标签时抛错，禁止自动新建。
 */
export async function ensureLocalShellTab(
  shellId: string,
  _opts?: { activate?: boolean },
): Promise<EnsureTabResult> {
  const open = findOpenLocalShellTab(shellId);
  if (open) return { tab: open, provisioned: false };

  const stale = findLocalShellTab(shellId);
  if (stale) return reconnectLocalShellTabInPlace(stale);

  const shells = await api.listLocalShells();
  const shell = shells.find((s) => s.id === shellId);
  if (!shell) throw new Error(`Shell not found: ${shellId}`);
  throw new Error(tabNotOpenError(shell));
}

/**
 * 使用已有 SSH 标签；无标签时抛错，禁止自动新建。
 */
export async function ensureSshTab(
  hostId: number,
  _opts?: { activate?: boolean },
): Promise<EnsureTabResult> {
  const open = findOpenSshTab(hostId);
  if (open) return { tab: open, provisioned: false };

  const stale = findSshTab(hostId);
  if (stale) return reconnectSshTabInPlace(stale);

  const host = await getHost(hostId);
  if (!host) throw new Error(`Host #${hostId} not found`);
  throw new Error(
    sshTabNotOpenError(hostId, host.name || host.host),
  );
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
