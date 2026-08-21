/**
 * @file 监听端口面板
 * @author Charlie
 * @description 解析 ss/netstat 输出，列出 TCP/UDP 监听端口与进程。
 * 支持按协议/公网过滤、复制端口号、向占用进程发 TERM/KILL。
 * 常见端口会打上服务名标签。
 */

import { Copy, RefreshCw, Search, Skull, XCircle } from "lucide-react";
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
import { clipboardWriteText } from "@/lib/clipboard";
import { dialogs } from "@/lib/dialogs";
import { killCmd, portsCmd, resolveProbeEnv } from "@/lib/probeEnv";
import { api } from "@/lib/tauri";

type PortRow = {
  id: string;
  proto: "tcp" | "udp";
  addr: string;
  port: number;
  state: string;
  pid?: string;
  process?: string;
};

type PortTag = {
  id: string;
  label: string;
  tone: "accent" | "warn" | "danger" | "muted";
};

/** 常见端口 → 服务名 */
const WELL_KNOWN: Record<number, string> = {
  22: "SSH",
  80: "HTTP",
  443: "HTTPS",
  3306: "MySQL",
  5432: "Postgres",
  6379: "Redis",
  27017: "Mongo",
  8080: "HTTP",
  8443: "HTTPS",
  9000: "MinIO",
  2375: "Docker",
  2376: "Docker",
  6443: "K8s",
};

/** 解析 ss / netstat 文本为端口行 */
function parsePorts(raw: string): PortRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: PortRow[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (
      /^Netid\b/i.test(line) ||
      /^Proto\b/i.test(line) ||
      /^Active\b/i.test(line) ||
      /^Active Connections/i.test(line) ||
      /^COMMAND\b/i.test(line) ||
      line === "---"
    ) {
      continue;
    }

    // macOS lsof: node  123 user  12u  IPv4 ...  TCP *:3000 (LISTEN)
    const lsof = line.match(
      /^(\S+)\s+(\d+)\s+\S+\s+\S+\s+IPv[46]\s+\S+\s+\S+\s+(TCP|UDP)\s+(\S+?)(?:\s+\(([^)]+)\))?$/i,
    );
    if (lsof) {
      const process = lsof[1];
      const pid = lsof[2];
      const proto = lsof[3].toLowerCase().startsWith("udp") ? "udp" : "tcp";
      const endpoint = lsof[4];
      const state = (lsof[5] || "").toUpperCase() || "LISTEN";
      const portMatch = endpoint.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = Number(portMatch[1]);
      const addr = endpoint.replace(/:\d+$/, "").replace(/^\*$/, "0.0.0.0");
      const id = `${proto}:${addr}:${port}:${pid}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, proto, addr, port, state, pid, process });
      continue;
    }

    const protoMatch = line.match(/\b(tcp|udp)6?\b/i);
    if (!protoMatch) continue;
    const proto = protoMatch[1].toLowerCase().startsWith("udp") ? "udp" : "tcp";

    // Windows netstat 优先取本地地址列：TCP  0.0.0.0:80  ...
    const winLocal = line.match(
      /^(?:TCP|UDP)\s+(\[?[0-9a-fA-F:.]+\]?|\*):(\d+)\s+/i,
    );
    const addrMatch =
      winLocal ||
      line.match(/(\[?[0-9a-fA-F:.]+\]?|\*|0\.0\.0\.0|::):\s*(\d+)\b/) ||
      line.match(/(\S+):(\d+)\s+/);
    if (!addrMatch) continue;
    const addr = (winLocal ? addrMatch[1] : addrMatch[1]).replace(
      /^\[|\]$/g,
      "",
    );
    const port = Number(winLocal ? addrMatch[2] : addrMatch[2]);
    if (!Number.isFinite(port)) continue;

    let pid: string | undefined;
    let process: string | undefined;
    const users = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (users) {
      process = users[1];
      pid = users[2];
    } else {
      const pidOnly = line.match(/\bpid[=:]?\s*(\d+)/i);
      if (pidOnly) pid = pidOnly[1];
      const nameOnly = line.match(/\/([^/\s]+)\s*$/);
      if (nameOnly) process = nameOnly[1];
      // Windows netstat -ano 行尾 PID
      if (!pid) {
        const tailPid = line.match(/\s(\d+)\s*$/);
        if (tailPid) pid = tailPid[1];
      }
    }

    const state = /\bLISTEN/i.test(line)
      ? "LISTEN"
      : /\bUNCONN\b/i.test(line)
        ? "UNCONN"
        : proto === "udp"
          ? "UDP"
          : "LISTEN";

    // Windows netstat：跳过非监听 TCP（UDP 除外）
    if (proto === "tcp" && !/\bLISTEN/i.test(line) && !/users:\(/i.test(line)) {
      continue;
    }

    const id = `${proto}:${addr}:${port}:${pid || ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, proto, addr, port, state, pid, process });
  }

  return out.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
}

/** 是否绑定到公网/非本机地址 */
function isPublic(addr: string) {
  return (
    addr === "*" ||
    addr === "0.0.0.0" ||
    addr === "::" ||
    addr === "::0" ||
    (!addr.startsWith("127.") && addr !== "localhost" && addr !== "::1")
  );
}

function buildTags(row: PortRow, t: (k: string) => string): PortTag[] {
  const tags: PortTag[] = [
    {
      id: "proto",
      label: row.proto.toUpperCase(),
      tone: row.proto === "udp" ? "warn" : "accent",
    },
  ];
  if (isPublic(row.addr)) {
    tags.push({ id: "pub", label: t("termTab.tagPublic"), tone: "danger" });
  } else {
    tags.push({ id: "local", label: t("termTab.tagLocal"), tone: "muted" });
  }
  const known = WELL_KNOWN[row.port];
  if (known) {
    tags.push({ id: "svc", label: known, tone: "accent" });
  }
  return tags.slice(0, 3);
}

function badgeVariant(tone: PortTag["tone"]) {
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "outline" as const;
  if (tone === "accent") return "default" as const;
  return "secondary" as const;
}

/**
 * 端口侧栏：列表、过滤、复制与杀进程。
 */
export function PortsPane({
  sessionId,
  kind,
  shellId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  shellId?: string | null;
}) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "tcp" | "udp" | "public">("all");
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
      const raw = await api.sessionExec(sessionId, portsCmd(env, shellId));
      setPorts(parsePorts(raw));
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
    let list = [...ports];
    if (filter === "tcp") list = list.filter((p) => p.proto === "tcp");
    if (filter === "udp") list = list.filter((p) => p.proto === "udp");
    if (filter === "public") list = list.filter((p) => isPublic(p.addr));
    const query = q.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (p) =>
          String(p.port).includes(query) ||
          p.addr.toLowerCase().includes(query) ||
          (p.process || "").toLowerCase().includes(query) ||
          (p.pid || "").includes(query) ||
          (WELL_KNOWN[p.port] || "").toLowerCase().includes(query),
      );
    }
    return list;
  }, [ports, q, filter]);

  const copyText = async (text: string) => {
    try {
      await clipboardWriteText(text);
    } catch {
      await dialogs.alert(t("termTab.copyFail"));
    }
  };

  const signal = async (row: PortRow, sig: "TERM" | "KILL") => {
    if (!sessionId || !row.pid) {
      await dialogs.alert(t("termTab.noPid"));
      return;
    }
    const ok = await dialogs.confirm(
      t("termTab.killPortConfirm", {
        port: row.port,
        pid: row.pid,
        process: row.process || "-",
        sig,
      }),
      { danger: true },
    );
    if (!ok) return;
    try {
      await api.sessionExec(sessionId, killCmd(env, row.pid, sig));
      await refresh();
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* —— 标题与刷新 —— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium">{t("termTab.ports")}</span>
        <span className="text-xs text-muted-foreground">
          {t("termTab.portCount", { count: filtered.length })}
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

      {/* —— 搜索与过滤 —— */}
      <div className="border-b border-border px-2 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search size={13} />
          </InputGroupAddon>
          <InputGroupInput
            className="text-xs"
            placeholder={t("termTab.portSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <div className="mt-2 flex flex-wrap gap-1">
          {(
            [
              ["all", t("termTab.filterAll")],
              ["tcp", "TCP"],
              ["udp", "UDP"],
              ["public", t("termTab.filterPublic")],
            ] as const
          ).map(([key, label]) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="xs"
                  variant={filter === key ? "default" : "outline"}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* —— 端口列表 —— */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {!sessionId || kind == null ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("scripts.needSessionShort")}
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("termTab.portEmpty")}
          </div>
        ) : (
          filtered.map((row) => {
            const tags = buildTags(row, t);
            const endpoint = `${row.addr}:${row.port}`;
            const procLabel = row.process
              ? row.process
              : row.pid
                ? `PID ${row.pid}`
                : t("termTab.unknownProc");
            return (
              <div
                key={row.id}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <div
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    isPublic(row.addr) ? "bg-destructive" : "bg-success"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-mono text-sm font-medium">
                      :{row.port}
                    </span>
                    <span
                      className="text-sm font-medium truncate"
                      title={procLabel}
                    >
                      {procLabel}
                    </span>
                  </div>
                  <div
                    className="text-xs text-muted-foreground truncate"
                    title={endpoint}
                  >
                    {endpoint} · {row.state}
                    {row.process && row.pid ? ` · PID ${row.pid}` : ""}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Badge key={tag.id} variant={badgeVariant(tag.tone)}>
                        {tag.label}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("termTab.tipCopyPort")}
                      onClick={() => copyText(String(row.port))}
                    >
                      <Copy size={13} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("termTab.tipCopyPort")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={!row.pid}
                      aria-label={t("termTab.tipTerm")}
                      onClick={() => signal(row, "TERM")}
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
                      disabled={!row.pid}
                      aria-label={t("termTab.tipKill")}
                      onClick={() => signal(row, "KILL")}
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
