/**
 * @file Pipeline 端点解析 → 会话 / FS
 * @author Charlie
 */

import { resolveFsEndpoint, type FsEndpoint } from "@/lib/fs";
import {
  ensureLocalShellTab,
  ensureSshTab,
  resolveDefaultWslShellId,
} from "@/lib/session/ensureSession";
import { api } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings";
import type { TermTab } from "@/stores/ui";
import type { PipelineEndpoint } from "@/lib/pipeline/types";

export type ResolvedEndpoint = {
  endpoint: FsEndpoint;
  tab: TermTab;
  sessionId: string;
};

async function defaultLocalShellId(): Promise<string> {
  const shells = await api.listLocalShells();
  const pref = useSettingsStore.getState().defaultLocalShell;
  if (pref) {
    const hit = shells.find((s) => s.id === pref);
    if (hit) return hit.id;
  }
  return shells.find((s) => s.isDefault)?.id ?? shells[0]?.id ?? "local:powershell";
}

/** 解析 Pipeline 端点为可执行会话 + FS 端点（须用户已手动打开对应终端标签） */
export async function resolvePipelineEndpoint(
  ep: PipelineEndpoint,
): Promise<ResolvedEndpoint> {
  if (ep.kind === "local") {
    const shellId = await defaultLocalShellId();
    const { tab } = await ensureLocalShellTab(shellId);
    const fs = resolveFsEndpoint(tab);
    if (!tab.sessionId || !fs) {
      throw new Error("本地 Shell 标签未连接，请先在终端打开并连接");
    }
    return {
      endpoint: fs,
      tab,
      sessionId: tab.sessionId,
    };
  }
  if (ep.kind === "wsl") {
    const shellId =
      ep.shell_id ?? (await resolveDefaultWslShellId(ep.wsl_distro));
    if (!shellId) throw new Error("未检测到 WSL 发行版");
    const { tab } = await ensureLocalShellTab(shellId);
    const fs = resolveFsEndpoint(tab);
    if (!tab.sessionId || !fs) {
      throw new Error("WSL 终端标签未连接，请先在终端打开对应 WSL 标签");
    }
    return {
      endpoint: fs,
      tab,
      sessionId: tab.sessionId,
    };
  }
  const { tab } = await ensureSshTab(ep.host_id);
  const fs = resolveFsEndpoint(tab);
  if (!tab.sessionId || !fs) {
    throw new Error("SSH 终端标签未连接，请先在终端打开对应主机标签");
  }
  return {
    endpoint: fs,
    tab,
    sessionId: tab.sessionId,
  };
}
