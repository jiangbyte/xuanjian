/**
 * @file Agent 执行平面上下文（本地 / WSL / SSH）
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import { resolveFsEndpoint } from "@/lib/fs";
import { resolveActiveWorkspace } from "@/lib/workspace/context";
import { api } from "@/lib/tauri";
import {
  findOpenLocalShellTab,
  findOpenSshTab,
} from "@/lib/session/ensureSession";
import type { TermTab } from "@/stores/ui";
import { useUiStore } from "@/stores/ui";

/** 执行平面标识，供 list_sessions 与 prompt 共用 */
export function describePlane(tab: TermTab): string {
  if (tab.kind === "ssh") return "remote-ssh";
  const sid = tab.shellId ?? "";
  if (sid.startsWith("local:wsl:")) return "local-wsl";
  if (sid === "local:git-bash") return "local-git-bash";
  if (sid === "local:powershell") return "local-windows-powershell";
  if (sid === "local:cmd") return "local-windows-cmd";
  if (sid.startsWith("local:")) return "local-unix-shell";
  return "local";
}

/** 获取 cwd 探测命令 */
export function cwdProbeCmd(tab: Pick<TermTab, "kind" | "shellId">): string {
  if (tab.kind === "ssh") return "pwd";
  const sid = tab.shellId ?? "";
  if (sid.startsWith("local:wsl:") || sid === "local:git-bash") return "pwd";
  if (sid === "local:powershell") return "(Get-Location).Path";
  if (sid === "local:cmd") return "cd";
  return "pwd";
}

async function probeTabCwd(tab: TermTab): Promise<string | null> {
  if (!tab.sessionId || tab.status !== "open") return null;
  const cmd = cwdProbeCmd(tab);
  try {
    const out = await Promise.race([
      api.sessionExec(tab.sessionId, cmd),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);
    if (out == null) return null;
    const line = stripAnsi(out).trim().split(/\r?\n/).pop()?.trim();
    return line || null;
  } catch {
    return null;
  }
}

function formatTabSummary(tab: TermTab, active: boolean): string {
  const ep = resolveFsEndpoint(tab);
  const parts = [
    `tabId=${tab.id}`,
    `title="${tab.title}"`,
    `plane=${describePlane(tab)}`,
    `kind=${tab.kind}`,
  ];
  if (tab.shellId) parts.push(`shellId=${tab.shellId}`);
  if (ep?.kind) parts.push(`fs=${ep.kind}`);
  if (tab.hostId != null) parts.push(`hostId=${tab.hostId}`);
  if (tab.sessionId) parts.push(`sessionId=${tab.sessionId}`);
  parts.push(`status=${tab.status}`);
  if (active) parts.push("(当前焦点)");
  return parts.join(" ");
}

/** 静态执行语义（同步，供 token 估算与 system prompt 基线） */
export function executionSemanticsBlock(): string {
  return [
    "【执行平面语义】",
    "- kind=local 且 shellId 以 local:wsl: 开头 → 本机 WSL（不是 SSH 远程）。编译、WSL Docker 在此执行。",
    "- kind=ssh → 远程 SSH；host_info、sync_to_remote、deploy 依赖 SSH 或工作空间 host_id。",
    "- network_*（ping/dns/tcp_probe/tls_cert）在 Windows 宿主机网络栈执行，不代表 SSH/WSL 内可达性。",
    "- 工作空间 sync/deploy 仅同步代码目录（local_root → remote_root），不用于数据库 dump 等大文件迁移。",
    "- Agent 命令在【下栏 Agent 终端】执行（用户可见），不在主终端写入。",
    "- 所有终端/文件/写操作工具均禁止自动新建用户终端标签；须用户先在终端手动打开对应标签。",
    "- Agent 工具仅在【当前焦点标签】执行，禁止跨标签。",
  ].join("\n");
}

/** 动态执行上下文块（注入每轮 ReAct system prompt） */
export async function buildExecutionContextBlock(): Promise<string> {
  const { tabs, activeTabId } = useUiStore.getState();
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const ws = await resolveActiveWorkspace();

  const lines: string[] = ["【当前执行环境】"];

  if (!tabs.length) {
    lines.push("（无已打开终端标签）");
  } else {
    const cwdResults = await Promise.all(tabs.map((t) => probeTabCwd(t)));
    if (active) {
      const idx = tabs.findIndex((t) => t.id === active.id);
      const cwd = idx >= 0 ? cwdResults[idx] : null;
      lines.push(`焦点: ${formatTabSummary(active, true)}`);
      if (cwd) lines.push(`焦点 cwd: ${cwd}`);
    }
    lines.push(
      "",
      "全部标签（tab_id 用于 session_exec / terminal_run / list_files 等）:",
    );
    tabs.forEach((t, i) => {
      const cwd = cwdResults[i];
      const suffix = cwd ? ` cwd=${cwd}` : "";
      lines.push(`- ${formatTabSummary(t, t.id === activeTabId)}${suffix}`);
    });
  }

  try {
    const shells = await api.listLocalShells();
    const wslShells = shells.filter((s) => s.id.startsWith("local:wsl:"));
    if (wslShells.length) {
      lines.push("", "可用 WSL（须先打开对应终端标签再执行）:");
      for (const s of wslShells) {
        const open = findOpenLocalShellTab(s.id);
        const state = open ? `已打开 tabId=${open.id}` : "未打开";
        lines.push(`- shellId=${s.id} name="${s.name}" ${state}`);
      }
    }
  } catch {
    /* ignore */
  }

  lines.push("");
  if (ws) {
    lines.push(
      `活动工作空间: "${ws.name}" (id=${ws.id})`,
      `  local_root: ${ws.local_root}`,
      `  remote_root: ${ws.remote_root}`,
      `  host_id: ${ws.host_id}`,
    );
  } else {
    lines.push("活动工作空间: 未绑定（仅 SSH 部署需要）");
  }

  return lines.join("\n");
}

let lastExecutionContextHash = "";

function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

/** 执行上下文变化时才返回新块（供 inbox.inject） */
export async function buildExecutionContextBlockIfChanged(): Promise<
  string | null
> {
  const block = await buildExecutionContextBlock();
  const h = hashText(block);
  if (h === lastExecutionContextHash) return null;
  lastExecutionContextHash = h;
  return block;
}

export function resetExecutionContextCache(): void {
  lastExecutionContextHash = "";
}

/** list_sessions 工具用的序列化 */
export async function serializeSessionsForAgent(): Promise<
  Record<string, unknown>
> {
  const { tabs, activeTabId } = useUiStore.getState();
  const cwdResults = await Promise.all(tabs.map((t) => probeTabCwd(t)));
  const openTabs = tabs.map((t, i) => {
    const ep = resolveFsEndpoint(t);
    return {
      tabId: t.id,
      title: t.title,
      kind: t.kind,
      shellId: t.shellId ?? null,
      plane: describePlane(t),
      fsKind: ep?.kind ?? null,
      sessionId: t.sessionId,
      hostId: t.hostId ?? null,
      status: t.status,
      active: t.id === activeTabId,
      cwd: cwdResults[i],
    };
  });

  let availableShells: Record<string, unknown>[] = [];
  try {
    const shells = await api.listLocalShells();
    availableShells = shells.map((s) => {
      const openTab = findOpenLocalShellTab(s.id);
      return {
        shellId: s.id,
        name: s.name,
        plane: s.id.startsWith("local:wsl:")
          ? "local-wsl"
          : s.id === "local:powershell"
            ? "local-windows-powershell"
            : "local",
        isDefault: s.isDefault,
        openTabId: openTab?.id ?? null,
        sessionReady: Boolean(openTab?.sessionId),
      };
    });
  } catch {
    /* ignore */
  }

  let availableHosts: Record<string, unknown>[] = [];
  try {
    const { listHosts } = await import("@/lib/db");
    const hosts = await listHosts();
    availableHosts = hosts.map((h) => {
      const openTab = findOpenSshTab(h.id);
      return {
        hostId: h.id,
        name: h.name,
        host: h.host,
        openTabId: openTab?.id ?? null,
        sessionReady: Boolean(openTab?.sessionId),
      };
    });
  } catch {
    /* ignore */
  }

  return {
    openTabs,
    availableShells,
    availableHosts,
    hint: "工具仅在当前焦点标签 (active=true) 执行；禁止跨标签。WSL/SSH 须用户先打开对应终端标签。",
  };
}
