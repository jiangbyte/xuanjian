/**
 * @file 主机资源概览面板
 * @author Charlie
 * @description 周期性执行探测脚本，解析 CPU/内存/磁盘/网络与 Top 进程。
 * 用迷你面积图展示近期采样；适配本地与 SSH 不同探测环境。
 * 无会话时显示需先连接的提示。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { api } from "@/lib/tauri";
import { metricsCmd, resolveProbeEnv } from "@/lib/probeEnv";

type Sample = {
  t: number;
  cpu: number;
  mem: number;
  disk: number;
  net: number;
};

type TopProc = {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  name: string;
};

type Metrics = {
  host: string;
  ips: string;
  cpuPct: number;
  cores: number;
  memUsed: number;
  memTotal: number;
  memAvail: number;
  swapUsed: number;
  swapTotal: number;
  diskUsed: number;
  diskTotal: number;
  diskMount: string;
  diskFs: string;
  netRx: number;
  netTx: number;
  load: string;
  uptime: string;
  system: string;
  kernel: string;
  top: TopProc[];
};

/** 解析探测脚本文本输出为指标与 CPU 计数器 */
function parseMetrics(
  raw: string,
  prevCpu?: { idle: number; total: number },
): {
  metrics: Metrics;
  cpuCounters: { idle: number; total: number };
} {
  const lines = raw.split(/\r?\n/);
  let load = "-";
  let uptime = "-";
  let memTotal = 0;
  let memUsed = 0;
  let memAvail = 0;
  let swapTotal = 0;
  let swapUsed = 0;
  let cores = 1;
  let cpuIdle = 0;
  let cpuTotal = 0;
  let diskTotal = 0;
  let diskUsed = 0;
  let diskMount = "/";
  let diskFs = "-";
  let netRx = 0;
  let netTx = 0;
  let system = "-";
  let host = "-";
  let ips = "-";
  let cpuPctDirect: number | null = null;
  const top: TopProc[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("HOST ")) host = line.slice(5).trim() || "-";
    if (line.startsWith("IP ")) {
      const v = line.slice(3).trim();
      if (v) ips = v.split(/\s+/).filter(Boolean).slice(0, 3).join(" · ");
    }
    if (line.startsWith("LOAD "))
      load = line.slice(5).trim().split(/\s+/).slice(0, 3).join(" ");
    if (line.startsWith("UP ")) {
      const sec = Number(line.slice(3).trim().split(/\s+/)[0] || 0);
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      const m = Math.floor((sec % 3600) / 60);
      uptime = d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
    }
    if (line.startsWith("MEM ")) {
      const [total, used, avail] = line
        .slice(4)
        .trim()
        .split(/\s+/)
        .map(Number);
      memTotal = total || 0;
      memUsed = used || 0;
      memAvail = avail || Math.max(0, memTotal - memUsed);
    }
    if (line.startsWith("SWAP ")) {
      const [total, used] = line.slice(5).trim().split(/\s+/).map(Number);
      swapTotal = total || 0;
      swapUsed = used || 0;
    }
    if (line.startsWith("CPUPCT ")) {
      cpuPctDirect = Number(line.slice(7).trim());
    }
    if (line.startsWith("CPU ")) {
      cores = Number(line.slice(4).trim()) || 1;
      const cpuLine = lines[i + 1] || "";
      if (cpuLine.startsWith("cpu ")) {
        const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
        cpuTotal = parts.reduce((a, b) => a + (b || 0), 0);
        cpuIdle = parts[3] || 0;
      }
    }
    if (line.startsWith("DF ")) {
      const parts = line.slice(3).trim().split(/\s+/);
      const total = Number(parts[0]);
      const used = Number(parts[1]);
      if (Number.isFinite(total) && total > 0) {
        diskTotal = total * 1024;
        diskUsed = (Number.isFinite(used) && used >= 0 ? used : 0) * 1024;
        diskMount = parts[2] || "/";
        diskFs = parts[3] || "-";
      }
    }
    if (line.startsWith("NET ")) {
      const [rx, tx] = line.slice(4).trim().split(/\s+/).map(Number);
      netRx = rx || 0;
      netTx = tx || 0;
    }
    if (line.startsWith("UNAME ")) {
      system = line.slice(6).trim() || "-";
    }
    if (line.startsWith("TOP ")) {
      const body = line.slice(4);
      const cols = body.split(/\t/);
      if (cols.length >= 5) {
        top.push({
          pid: cols[0],
          user: cols[1],
          cpu: cols[2],
          mem: cols[3],
          name: cols.slice(4).join("\t") || "-",
        });
      }
    }
  }

  let cpuPct = 0;
  if (cpuPctDirect != null && Number.isFinite(cpuPctDirect)) {
    cpuPct = Math.max(0, Math.min(100, cpuPctDirect));
  } else if (prevCpu && cpuTotal > prevCpu.total) {
    const dTotal = cpuTotal - prevCpu.total;
    const dIdle = cpuIdle - prevCpu.idle;
    cpuPct = Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
  }

  const kernel = system.includes(" ")
    ? system.split(/\s+/).slice(1).join(" ")
    : system;

  return {
    metrics: {
      host,
      ips,
      cpuPct,
      cores,
      memUsed,
      memTotal,
      memAvail,
      swapUsed,
      swapTotal,
      diskUsed,
      diskTotal,
      diskMount,
      diskFs,
      netRx,
      netTx,
      load,
      uptime,
      system: system.split(/\s+/)[0] || "-",
      kernel,
      top,
    },
    cpuCounters: { idle: cpuIdle, total: cpuTotal },
  };
}

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function fmtRate(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B/s";
  if (n < 1024) return `${n.toFixed(0)} B/s`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 ** 2).toFixed(1)} MB/s`;
}

function pct(used: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

/** 迷你面积图：资源趋势火花线 */
function Spark({
  data,
  color,
  dataKey,
}: {
  data: Sample[];
  color: string;
  dataKey: keyof Sample;
}) {
  if (data.length < 2) {
    return <div className="h-8 rounded-sm bg-muted" />;
  }
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={data}>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          fill={color}
          fillOpacity={0.18}
          strokeWidth={1.5}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** 百分比进度条 */
function Bar({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${v}%`, background: color }}
      />
    </div>
  );
}

/**
 * 主机概览侧栏：主机信息、资源卡片、Swap、Top 进程。
 */
export function OverviewPane({
  sessionId,
  kind,
  shellId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  shellId?: string | null;
}) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [netRate, setNetRate] = useState({ rx: 0, tx: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cpuHold = useRef<{ idle: number; total: number } | null>(null);
  const netHold = useRef({ rx: 0, tx: 0, at: 0 });
  const env = resolveProbeEnv(kind, shellId);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setError(t("scripts.needSessionShort"));
      return;
    }
    setLoading(true);
    try {
      const raw = await api.sessionExec(sessionId, metricsCmd(env, shellId));
      const parsed = parseMetrics(raw, cpuHold.current ?? undefined);
      cpuHold.current = parsed.cpuCounters;
      const now = Date.now();
      let rxRate = 0;
      let txRate = 0;
      if (netHold.current.at > 0) {
        const dt = Math.max(0.5, (now - netHold.current.at) / 1000);
        rxRate = Math.max(0, parsed.metrics.netRx - netHold.current.rx) / dt;
        txRate = Math.max(0, parsed.metrics.netTx - netHold.current.tx) / dt;
      }
      netHold.current = {
        rx: parsed.metrics.netRx,
        tx: parsed.metrics.netTx,
        at: now,
      };
      setNetRate({ rx: rxRate, tx: txRate });

      const memPct = pct(parsed.metrics.memUsed, parsed.metrics.memTotal);
      const diskPct = pct(parsed.metrics.diskUsed, parsed.metrics.diskTotal);
      setMetrics(parsed.metrics);
      setSamples((prev) =>
        [
          ...prev,
          {
            t: now,
            cpu: parsed.metrics.cpuPct,
            mem: memPct,
            disk: diskPct,
            net: (rxRate + txRate) / 1024,
          },
        ].slice(-30),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t, env, shellId]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const memPct = pct(metrics?.memUsed ?? 0, metrics?.memTotal ?? 0);
  const diskPct = pct(metrics?.diskUsed ?? 0, metrics?.diskTotal ?? 0);
  const swapPct = pct(metrics?.swapUsed ?? 0, metrics?.swapTotal ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium">{t("termTab.overview")}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => refresh()}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("terminal.refresh")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {!sessionId || kind == null ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {t("scripts.needSessionShort")}
          </p>
        ) : error && !metrics ? (
          <div className="px-2 py-4 text-xs text-destructive">{error}</div>
        ) : (
          <>
            {/* —— 主机身份与负载 —— */}
            <div className="rounded-md border border-border bg-background px-2.5 py-2.5">
              <div className="flex items-start gap-2">
                <Server size={14} className="mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {metrics?.host || "-"}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {metrics?.ips || "-"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-muted-foreground">
                    {metrics?.uptime || "-"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("termTab.load")} {metrics?.load || "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* —— CPU / 内存 / 磁盘 / 网络 —— */}
            <ResourceCard
              icon={<Cpu size={13} />}
              title="CPU"
              color="#3b82f6"
              value={`${(metrics?.cpuPct ?? 0).toFixed(0)}%`}
              detail={`${metrics?.cores ?? "-"} ${t("termTab.cores")}`}
              bar={metrics?.cpuPct ?? 0}
              spark={<Spark data={samples} color="#3b82f6" dataKey="cpu" />}
            />
            <ResourceCard
              icon={<MemoryStick size={13} />}
              title={t("termTab.memory")}
              color="#22c55e"
              value={`${memPct.toFixed(0)}%`}
              detail={
                metrics
                  ? `${fmtBytes(metrics.memUsed)} / ${fmtBytes(metrics.memTotal)}`
                  : "-"
              }
              extra={
                metrics
                  ? `${t("termTab.memAvail")} ${fmtBytes(metrics.memAvail)}`
                  : undefined
              }
              bar={memPct}
              spark={<Spark data={samples} color="#22c55e" dataKey="mem" />}
            />
            <ResourceCard
              icon={<HardDrive size={13} />}
              title={t("termTab.disk")}
              color="#f59e0b"
              value={`${diskPct.toFixed(0)}%`}
              detail={
                metrics
                  ? `${fmtBytes(metrics.diskUsed)} / ${fmtBytes(metrics.diskTotal)}`
                  : "-"
              }
              extra={
                metrics
                  ? `${metrics.diskMount}${metrics.diskFs && metrics.diskFs !== "-" ? ` · ${metrics.diskFs}` : ""}`
                  : undefined
              }
              bar={diskPct}
              spark={<Spark data={samples} color="#f59e0b" dataKey="disk" />}
            />
            <ResourceCard
              icon={<Network size={13} />}
              title={t("termTab.network")}
              color="#06b6d4"
              value={fmtRate(netRate.rx + netRate.tx)}
              detail={`↓ ${fmtRate(netRate.rx)}  ·  ↑ ${fmtRate(netRate.tx)}`}
              extra={
                metrics
                  ? `${t("termTab.netTotal")} ${fmtBytes(metrics.netRx + metrics.netTx)}`
                  : undefined
              }
              bar={Math.min(
                100,
                ((netRate.rx + netRate.tx) / (512 * 1024)) * 100,
              )}
              spark={<Spark data={samples} color="#06b6d4" dataKey="net" />}
            />

            {(metrics?.swapTotal ?? 0) > 0 && (
              <div className="rounded-md border border-border bg-background px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{t("termTab.swap")}</span>
                  <span className="font-medium">
                    {fmtBytes(metrics!.swapUsed)} /{" "}
                    {fmtBytes(metrics!.swapTotal)}
                  </span>
                </div>
                <Bar value={swapPct} color="#a855f7" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <InfoBox
                label={t("termTab.system")}
                value={metrics?.system || "-"}
              />
              <InfoBox
                label={t("termTab.kernel")}
                value={metrics?.kernel || "-"}
              />
            </div>

            {/* —— Top 进程 —— */}
            {metrics && metrics.top.length > 0 && (
              <div className="rounded-md border border-border bg-background px-2 py-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Activity size={12} />
                  {t("termTab.topProcesses")}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 px-0.5 text-[10px] text-muted-foreground">
                    <span className="w-16 shrink-0">PID</span>
                    <span className="min-w-0 flex-1">
                      {t("termTab.procName")}
                    </span>
                    <span className="w-12 shrink-0 text-right">CPU</span>
                    <span className="w-12 shrink-0 text-right">MEM</span>
                  </div>
                  {metrics.top.map((p) => (
                    <div
                      key={`${p.pid}-${p.name}`}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="w-16 shrink-0 truncate font-mono tabular-nums text-muted-foreground">
                        {p.pid}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-medium"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono tabular-nums text-[#3b82f6]">
                        {p.cpu}%
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono tabular-nums text-[#22c55e]">
                        {p.mem}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 单资源卡片：数值、详情、进度条与火花图 */
function ResourceCard({
  icon,
  title,
  color,
  value,
  detail,
  extra,
  bar,
  spark,
}: {
  icon: ReactNode;
  title: string;
  color: string;
  value: string;
  detail: string;
  extra?: string;
  bar: number;
  spark?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-1.5 text-[11px] font-medium"
            style={{ color }}
          >
            {icon}
            {title}
          </div>
          <div className="mt-1 text-xl font-semibold leading-none">{value}</div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>
          {extra && (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{extra}</p>
          )}
        </div>
      </div>
      <div className="mt-2">
        <Bar value={bar} color={color} />
      </div>
      {spark && <div className="mt-2">{spark}</div>}
    </div>
  );
}

/** 系统/内核等键值信息格 */
function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 truncate font-medium" title={value}>
        {value}
      </div>
    </div>
  );
}
