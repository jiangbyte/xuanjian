/**
 * @file 监听端口面板
 * @author Charlie
 * @description 解析 ss/netstat 输出，列出 TCP/UDP 监听端口与进程。
 * 支持按协议/公网过滤、复制端口号、向占用进程发 TERM/KILL。
 * 常见端口会打上服务名标签。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, RefreshCw, Search, Skull, XCircle } from "lucide-react";
import { api } from "@/lib/tauri";
import { clipboardWriteText } from "@/lib/clipboard";
import { useDialog } from "@/components/Dialog";
import { killCmd, portsCmd, resolveProbeEnv } from "@/lib/probeEnv";

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
      /^Active Connections/i.test(line)
    ) {
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

function tipClass(tone: PortTag["tone"]) {
  if (tone === "accent") return "chip chip-accent";
  if (tone === "warn") return "chip chip-warn";
  if (tone === "danger") return "chip chip-danger";
  return "chip";
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
  const dialog = useDialog();
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
      await dialog.alert(t("termTab.copyFail"));
    }
  };

  const signal = async (row: PortRow, sig: "TERM" | "KILL") => {
    if (!sessionId || !row.pid) {
      await dialog.alert(t("termTab.noPid"));
      return;
    }
    const ok = await dialog.confirm(
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
      await dialog.alert(String(e));
    }
  };

  return (
    <div className="panel flex h-full flex-col">
      {/* —— 标题与刷新 —— */}
      <div className="panel-header flex items-center gap-2">
        <span className="text-xs font-medium">{t("termTab.ports")}</span>
        <span className="text-xs muted">
          {t("termTab.portCount", { count: filtered.length })}
        </span>
        <button
          className="icon-btn icon-btn-sm tip ml-auto"
          data-tip={t("terminal.refresh")}
          onClick={() => refresh()}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* —— 搜索与过滤 —— */}
      <div className="border-b border-[var(--border)] px-2 py-2">
        <div className="field-icon-wrap">
          <Search size={13} className="field-icon" />
          <input
            className="field field-sm"
            placeholder={t("termTab.portSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
          {(
            [
              ["all", t("termTab.filterAll")],
              ["tcp", "TCP"],
              ["udp", "UDP"],
              ["public", t("termTab.filterPublic")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`btn btn-sm tip ${filter === key ? "btn-primary" : ""}`}
              data-tip={label}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* —— 端口列表 —— */}
      <div className="panel-body panel-list min-h-0 flex-1 overflow-y-auto p-1.5">
        {!sessionId || kind == null ? (
          <div className="px-2 py-6 text-center text-xs muted">
            {t("scripts.needSessionShort")}
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-danger">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs muted">
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
              <div key={row.id} className="list-row items-start gap-2">
                <div
                  className={`list-row-dot mt-1.5 ${
                    isPublic(row.addr) ? "is-danger" : "is-ok"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="list-row-title list-row-title-mono shrink-0">
                      :{row.port}
                    </span>
                    <span className="list-row-title truncate" title={procLabel}>
                      {procLabel}
                    </span>
                  </div>
                  <div className="list-row-sub truncate" title={endpoint}>
                    {endpoint} · {row.state}
                    {row.process && row.pid ? ` · PID ${row.pid}` : ""}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span key={tag.id} className={tipClass(tag.tone)}>
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="icon-btn icon-btn-sm tip"
                  data-tip={t("termTab.tipCopyPort")}
                  onClick={() => copyText(String(row.port))}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-btn icon-btn-sm tip"
                  data-tip={t("termTab.tipTerm")}
                  disabled={!row.pid}
                  onClick={() => signal(row, "TERM")}
                >
                  <XCircle size={13} />
                </button>
                <button
                  className="icon-btn icon-btn-sm tip"
                  data-tip={t("termTab.tipKill")}
                  disabled={!row.pid}
                  onClick={() => signal(row, "KILL")}
                >
                  <Skull size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
