/**
 * @file 机群概览仪表盘
 * @author Charlie
 */

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ConsoleEmptyState,
  ConsolePageHeader,
} from "@/components/ConsolePageHeader";
import { MetricBar } from "@/components/MetricBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listGroups, listHosts, type HostRow } from "@/lib/db";
import { connectSshHost } from "@/lib/session/connect";
import { metricsCmd, resolveProbeEnv } from "@/lib/session/probeEnv";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type ProbeRow = {
  host: HostRow;
  ok: boolean;
  cpuPct?: number;
  memPct?: number;
  diskPct?: number;
  error?: string;
  pending?: boolean;
};

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return (used / total) * 100;
}

function parseProbeOutput(raw: string): {
  cpuPct: number;
  memPct: number;
  diskPct: number;
} {
  let cpuPct = 0;
  let memUsed = 0;
  let memTotal = 0;
  let diskUsed = 0;
  let diskTotal = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("CPU ")) cpuPct = Number(line.slice(4).trim()) || 0;
    if (line.startsWith("MEM ")) {
      const parts = line.slice(4).trim().split(/\s+/);
      memTotal = Number(parts[0]) || 0;
      memUsed = Number(parts[1]) || 0;
    }
    if (line.startsWith("DISK ")) {
      const parts = line.slice(5).trim().split(/\s+/);
      diskTotal = Number(parts[0]) || 0;
      diskUsed = Number(parts[1]) || 0;
    }
  }
  return {
    cpuPct,
    memPct: pct(memUsed, memTotal),
    diskPct: pct(diskUsed, diskTotal),
  };
}

const ALL_GROUPS = "all";

function StatCell({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof Server;
  tone?: "default" | "ok" | "warn" | "err";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "err"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="border border-border bg-background px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={14} />
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
    </div>
  );
}

/** 机群指标探测仪表盘 */
export function FleetDashboard() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof listGroups>>>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [groupId, setGroupId] = useState<string>(ALL_GROUPS);
  const [probes, setProbes] = useState<ProbeRow[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    Promise.all([listGroups(), listHosts()])
      .then(([g, h]) => {
        setGroups(g);
        setHosts(h);
      })
      .catch(console.error);
  }, []);

  const targets = useMemo(() => {
    if (groupId === ALL_GROUPS) return hosts;
    const gid = Number(groupId);
    return hosts.filter((h) => h.group_id === gid);
  }, [hosts, groupId]);

  const stats = useMemo(() => {
    const done = probes.filter((p) => !p.pending);
    const ok = done.filter((p) => p.ok).length;
    const fail = done.filter((p) => !p.ok).length;
    const warn = done.filter(
      (p) =>
        p.ok &&
        ((p.cpuPct ?? 0) >= 85 ||
          (p.memPct ?? 0) >= 85 ||
          (p.diskPct ?? 0) >= 90),
    ).length;
    return { ok, fail, warn, total: targets.length };
  }, [probes, targets.length]);

  const probeAll = async () => {
    if (!targets.length || running) return;
    setRunning(true);
    setProbes(targets.map((host) => ({ host, ok: false, pending: true })));
    const env = resolveProbeEnv("ssh", null);
    const cmd = metricsCmd(env);
    const concurrency = 5;
    const results: ProbeRow[] = targets.map((host) => ({
      host,
      ok: false,
      pending: true,
    }));
    let next = 0;

    async function worker() {
      while (next < targets.length) {
        const idx = next;
        next += 1;
        const host = targets[idx];
        try {
          const { session } = await connectSshHost(host.id, { runStartup: false });
          try {
            const raw = await api.sessionExec(session.id, cmd);
            const parsed = parseProbeOutput(raw);
            results[idx] = { host, ok: true, ...parsed, pending: false };
          } finally {
            await api.sessionClose(session.id).catch(() => undefined);
          }
        } catch (e) {
          results[idx] = { host, ok: false, error: String(e), pending: false };
        }
        setProbes([...results]);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
    );
    setProbes(results);
    setRunning(false);
    const ok = results.filter((r) => r.ok).length;
    toast.success(t("fleet.probeDone"), {
      description: t("fleet.probeDoneDesc", { ok, total: results.length }),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConsolePageHeader
        icon={Activity}
        title={t("fleet.title")}
        description={t("fleet.subtitle")}
        toolbar={
          <>
            <div className="space-y-1">
              <Label className="sr-only">{t("fleet.group")}</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_GROUPS}>{t("fleet.allGroups")}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={running || !targets.length}
              onClick={() => probeAll().catch(console.error)}
            >
              {running ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {t("fleet.probe")}
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {probes.length > 0 ? (
          <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
            <StatCell label={t("fleet.statTotal")} value={stats.total} icon={Server} />
            <StatCell
              label={t("fleet.statOnline")}
              value={stats.ok}
              icon={CheckCircle2}
              tone="ok"
            />
            <StatCell
              label={t("fleet.statFailed")}
              value={stats.fail}
              icon={XCircle}
              tone="err"
            />
            <StatCell
              label={t("fleet.statWarn")}
              value={stats.warn}
              icon={AlertTriangle}
              tone="warn"
            />
          </div>
        ) : null}

        {probes.length === 0 ? (
          <div className="p-5">
            <ConsoleEmptyState
              icon={Activity}
              title={t("fleet.empty")}
              description={t("fleet.emptyHint")}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t("fleet.colHost")}</th>
                  <th className="px-4 py-2.5 font-medium">CPU</th>
                  <th className="px-4 py-2.5 font-medium">{t("fleet.colMem")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("fleet.colDisk")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("fleet.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {probes.map((p) => (
                  <tr
                    key={p.host.id}
                    className="border-b border-border hover:bg-muted/20"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Server size={15} className="shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{p.host.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.host.host}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.pending ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      ) : p.ok ? (
                        <MetricBar value={p.cpuPct ?? 0} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.pending ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      ) : p.ok ? (
                        <MetricBar value={p.memPct ?? 0} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.pending ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      ) : p.ok ? (
                        <MetricBar value={p.diskPct ?? 0} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.pending ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t("fleet.probing")}
                        </Badge>
                      ) : p.ok ? (
                        <Badge variant="secondary" className="text-[10px]">
                          OK
                        </Badge>
                      ) : (
                        <span
                          className="inline-block max-w-[180px] truncate text-xs text-destructive"
                          title={p.error}
                        >
                          {p.error?.slice(0, 48) ?? "ERR"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
