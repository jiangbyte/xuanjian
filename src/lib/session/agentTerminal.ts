/**
 * @file Agent 下栏终端
 * @description 为当前用户标签创建/复用独立 PTY，供 Agent 可观测执行。
 */

import { connectSshHost } from "@/lib/session/connect";
import { startRecordingForOpenTab } from "@/lib/session/recorder";
import { api } from "@/lib/tauri";
import { type AgentTermTab, type TermTab, useUiStore } from "@/stores/ui";

const inflightByTabId = new Map<string, Promise<AgentTermTab>>();

async function resolveShellId(tab: TermTab): Promise<string> {
  if (tab.shellId) return tab.shellId;
  const shells = await api.listLocalShells();
  const byName = shells.find((s) => s.name === tab.title || s.id === tab.title);
  if (byName) return byName.id;
  const def = shells.find((s) => s.isDefault) || shells[0];
  if (!def) throw new Error("No local shell available");
  return def.id;
}

function agentTitle(parent: TermTab, index: number): string {
  const base = `Agent · ${parent.title}`;
  return index > 0 ? `${base} (${index + 1})` : base;
}

async function openAgentSession(
  parent: TermTab,
  agentTabId: string,
): Promise<string> {
  if (parent.kind === "ssh" && parent.hostId != null) {
    const { session } = await connectSshHost(parent.hostId, {
      runStartup: false,
    });
    await startRecordingForOpenTab(agentTabId, session.id);
    return session.id;
  }

  const shellId = await resolveShellId(parent);
  const session = await api.localShellOpen(shellId);
  await startRecordingForOpenTab(agentTabId, session.id);
  useUiStore.getState().updateAgentTab(agentTabId, { shellId });
  return session.id;
}

/** 为指定用户标签确保至少一个可用的 Agent 下栏终端 */
export async function ensureAgentTerminal(
  parent: TermTab,
  opts?: { forceNew?: boolean },
): Promise<AgentTermTab> {
  const store = useUiStore.getState();
  const siblings = store.agentTabs.filter((t) => t.parentTabId === parent.id);

  if (!opts?.forceNew) {
    const existing =
      siblings.find((t) => t.status === "open" && t.sessionId) ??
      siblings.find((t) => t.status === "connecting");
    if (existing) {
      if (existing.sessionId && existing.status === "open") {
        store.setActiveAgentTab(existing.id);
        store.setBottomPanelCollapsed(false);
        return existing;
      }
      if (existing.status === "connecting") {
        const inflight = inflightByTabId.get(existing.id);
        store.setActiveAgentTab(existing.id);
        store.setBottomPanelCollapsed(false);
        if (inflight) return inflight;
      }
    }
  }

  const id = crypto.randomUUID();
  const tab: AgentTermTab = {
    id,
    title: agentTitle(parent, siblings.length),
    parentTabId: parent.id,
    kind: parent.kind,
    hostId: parent.hostId,
    shellId: parent.shellId,
    sessionId: null,
    status: "connecting",
  };
  store.addAgentTab(tab);

  const connectPromise = (async () => {
    try {
      const sessionId = await openAgentSession(parent, id);
      store.updateAgentTab(id, { sessionId, status: "open" });
      return { ...tab, sessionId, status: "open" as const };
    } catch (e) {
      store.updateAgentTab(id, { status: "error", sessionId: null });
      throw e;
    } finally {
      inflightByTabId.delete(id);
    }
  })();
  inflightByTabId.set(id, connectPromise);
  return connectPromise;
}

/** 将 Agent 标签转为 XtermView 可消费的 TermTab 形状 */
export function agentTabAsTermTab(tab: AgentTermTab): TermTab {
  return {
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    sessionId: tab.sessionId,
    hostId: tab.hostId,
    shellId: tab.shellId,
    logId: tab.logId,
    status: tab.status,
  };
}
