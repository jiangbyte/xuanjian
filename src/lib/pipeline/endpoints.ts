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
  provisioned: boolean;
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

/** 解析 Pipeline 端点为可执行会话 + FS 端点 */
export async function resolvePipelineEndpoint(
  ep: PipelineEndpoint,
): Promise<ResolvedEndpoint> {
  if (ep.kind === "local") {
    const shellId = await defaultLocalShellId();
    const { tab, provisioned } = await ensureLocalShellTab(shellId);
    const fs = resolveFsEndpoint(tab);
    if (!tab.sessionId || !fs) throw new Error("Failed to open local shell");
    return {
      endpoint: fs,
      tab,
      sessionId: tab.sessionId,
      provisioned,
    };
  }
  if (ep.kind === "wsl") {
    const shellId =
      ep.shell_id ?? (await resolveDefaultWslShellId(ep.wsl_distro));
    if (!shellId) throw new Error("No WSL distro available");
    const { tab, provisioned } = await ensureLocalShellTab(shellId);
    const fs = resolveFsEndpoint(tab);
    if (!tab.sessionId || !fs) throw new Error("Failed to open WSL session");
    return {
      endpoint: fs,
      tab,
      sessionId: tab.sessionId,
      provisioned,
    };
  }
  const { tab, provisioned } = await ensureSshTab(ep.host_id);
  const fs = resolveFsEndpoint(tab);
  if (!tab.sessionId || !fs) throw new Error("Failed to open SSH session");
  return {
    endpoint: fs,
    tab,
    sessionId: tab.sessionId,
    provisioned,
  };
}
