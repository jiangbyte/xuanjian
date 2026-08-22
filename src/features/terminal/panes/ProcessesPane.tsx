/**
 * @file 进程列表面板
 * @author Charlie
 * @description 通过探测命令拉取进程列表，支持搜索与按 CPU/内存/PID 排序。
 * 可为进程打标签（root、高负载、Docker 等），并发送 TERM/KILL。
 * 无会话时提示需先连接。
 */

import { RefreshCw, Search, Skull, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { dialogs } from "@/lib/ui/dialogs";
import { killCmd, processesCmd, resolveProbeEnv } from "@/lib/session/probeEnv";
import { api } from "@/lib/tauri";

type Proc = {
  pid: string;
  user: string;
  cpu: number;
  mem: number;
  cmd: string;
};

type ProcTag = {
  id: string;
  label: string;
  tone: "accent" | "warn" | "danger" | "muted";
};

/** 解析 ps 风格输出 */
function parsePs(raw: string): Proc[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Proc[] = [];
  for (const line of lines) {
    if (/^PID\b/i.test(line)) continue;
    const m = line.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    out.push({
      pid: m[1],
      user: m[2],
      cpu: Number(m[3]) || 0,
      mem: Number(m[4]) || 0,
      cmd: m[5],
    });
  }
  return out;
}

/** 从完整命令行提取短进程名 */
function shortProcName(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) return "?";
  if (trimmed.startsWith("[")) {
    const bracket = trimmed.match(/^\[[^\]]+\]/);
    return bracket ? bracket[0] : trimmed.slice(0, 28);
  }
  const token = trimmed.split(/\s+/)[0] || trimmed;
  const base = token.split("/").pop() || token;
  return base.replace(/:$/, "") || trimmed.slice(0, 28);
}

function buildTags(p: Proc, t: (key: string) => string): ProcTag[] {
  const tags: ProcTag[] = [];
  if (p.user === "root") {
    tags.push({ id: "root", label: t("termTab.tagRoot"), tone: "warn" });
  } else {
    tags.push({ id: "user", label: p.user, tone: "muted" });
  }
  if (p.cpu >= 30) {
    tags.push({ id: "cpu", label: t("termTab.tagHotCpu"), tone: "danger" });
  } else if (p.cpu >= 10) {
    tags.push({ id: "cpu", label: t("termTab.tagBusy"), tone: "warn" });
  }
  if (p.mem >= 15) {
    tags.push({ id: "mem", label: t("termTab.tagHotMem"), tone: "danger" });
  }
  const cmd = p.cmd.toLowerCase();
  if (/docker|containerd|runc|podman/.test(cmd)) {
    tags.push({ id: "docker", label: "Docker", tone: "accent" });
  } else if (/nginx|httpd|caddy/.test(cmd)) {
    tags.push({ id: "web", label: "Web", tone: "accent" });
  } else if (/postgres|mysql|mariadb|redis|mongo|minio/.test(cmd)) {
    tags.push({ id: "db", label: t("termTab.tagData"), tone: "accent" });
  } else if (/ssh|sshd/.test(cmd)) {
    tags.push({ id: "ssh", label: "SSH", tone: "muted" });
  }
  return tags.slice(0, 3);
}

function badgeVariant(tone: ProcTag["tone"]) {
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "outline" as const;
  if (tone === "accent") return "default" as const;
  return "secondary" as const;
}

/**
 * 进程侧栏：列表、排序、TERM/KILL。
 */
export function ProcessesPane({
  sessionId,
  kind,
  shellId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  shellId?: string | null;
}) {
  const { t } = useTranslation();
  const [procs, setProcs] = useState<Proc[]>([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"cpu" | "mem" | "pid">("cpu");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const env = resolveProbeEnv(kind, shellId);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setError(t("scripts.needSessionShort"));
      return;
    }
    setLoading(true);
    try {
      const raw = await api.sessionExec(sessionId, processesCmd(env, shellId));
      setProcs(parsePs(raw));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t, env, shellId]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = [...procs];
    if (query) {
      list = list.filter(
        (p) =>
          p.cmd.toLowerCase().includes(query) ||
          p.user.toLowerCase().includes(query) ||
          p.pid.includes(query),
      );
    }
    list.sort((a, b) => {
      if (sort === "mem") return b.mem - a.mem;
      if (sort === "pid") return Number(a.pid) - Number(b.pid);
      return b.cpu - a.cpu;
    });
    return list;
  }, [procs, q, sort]);

  const signal = async (pid: string, sig: "TERM" | "KILL") => {
    if (!sessionId) return;
    const ok = await dialogs.confirm(t("termTab.killConfirm", { pid, sig }), {
      danger: true,
    });
    if (!ok) return;
    try {
      await api.sessionExec(sessionId, killCmd(env, pid, sig));
      await refresh();
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* —— 标题与刷新 —— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium">{t("termTab.processes")}</span>
        <span className="text-xs text-muted-foreground">
          {t("termTab.procCount", { count: filtered.length })}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              aria-label={t("terminal.refresh")}
              onClick={() => refresh()}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("terminal.refresh")}</TooltipContent>
        </Tooltip>
      </div>

      {/* —— 搜索与排序 —— */}
      <div className="border-b border-border px-2 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search size={13} />
          </InputGroupAddon>
          <InputGroupInput
            className="text-xs"
            placeholder={t("termTab.procSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <div className="mt-2 flex flex-wrap gap-1">
          {(["cpu", "mem", "pid"] as const).map((key) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="xs"
                  variant={sort === key ? "default" : "outline"}
                  onClick={() => setSort(key)}
                >
                  {key.toUpperCase()}
                  {sort === key ? " ↓" : ""}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t(`termTab.sortBy.${key}`)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* —— 进程列表 —— */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {!sessionId || kind == null ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("scripts.needSessionShort")}
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-destructive">{error}</div>
        ) : (
          filtered.map((p) => {
            const tags = buildTags(p, t);
            const name = shortProcName(p.cmd);
            return (
              <div
                key={p.pid}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <div
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    p.cpu >= 30
                      ? "bg-destructive"
                      : p.cpu >= 10
                        ? "bg-primary"
                        : "bg-success"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" title={p.cmd}>
                    {name}
                  </div>
                  {name !== p.cmd && (
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={p.cmd}
                    >
                      {p.cmd}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    PID {p.pid} · CPU {p.cpu.toFixed(1)}% · MEM{" "}
                    {p.mem.toFixed(1)}%
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <Badge key={tag.id} variant={badgeVariant(tag.tone)}>
                          {tag.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("termTab.tipTerm")}
                      onClick={() => signal(p.pid, "TERM")}
                    >
                      <XCircle size={13} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("termTab.tipTerm")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("termTab.tipKill")}
                      onClick={() => signal(p.pid, "KILL")}
                    >
                      <Skull size={13} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("termTab.tipKill")}</TooltipContent>
                </Tooltip>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
