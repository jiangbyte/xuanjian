/**
 * @file 网卡流量监控（sysinfo）
 */

import { Pause, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type InterfaceTraffic } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function fmtBytes(n: number) {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtRate(bps: number) {
  const bits = bps * 8;
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(2)} Mbps`;
  if (bits >= 1000) return `${(bits / 1000).toFixed(1)} Kbps`;
  return `${Math.round(bits)} bps`;
}

type RateSample = { t: number; down: number; up: number };

/** 实时网卡收发速率 */
export function TrafficMonitorPage() {
  const { t } = useTranslation();
  const [ifaces, setIfaces] = useState<InterfaceTraffic[]>([]);
  const [rates, setRates] = useState<
    Record<string, { rx: number; tx: number }>
  >({});
  const [samples, setSamples] = useState<RateSample[]>([]);
  const [polling, setPolling] = useState(true);
  const [busy, setBusy] = useState(false);
  const prevRef = useRef<{
    at: number;
    data: InterfaceTraffic[];
  } | null>(null);

  const poll = useCallback(async () => {
    setBusy(true);
    try {
      const data = await api.networkInterfaceTraffic();
      const now = Date.now();
      const prev = prevRef.current;
      if (prev && now > prev.at) {
        const dt = (now - prev.at) / 1000;
        const nextRates: Record<string, { rx: number; tx: number }> = {};
        let totalDown = 0;
        let totalUp = 0;
        for (const row of data) {
          const old = prev.data.find((p) => p.name === row.name);
          if (!old) continue;
          const rx = Math.max(0, (row.receivedBytes - old.receivedBytes) / dt);
          const tx = Math.max(
            0,
            (row.transmittedBytes - old.transmittedBytes) / dt,
          );
          nextRates[row.name] = { rx, tx };
          totalDown += rx;
          totalUp += tx;
        }
        setRates(nextRates);
        setSamples((s) => {
          const next = [...s, { t: now, down: totalDown, up: totalUp }].slice(
            -60,
          );
          return next;
        });
      }
      prevRef.current = { at: now, data };
      setIfaces(data);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    if (!polling) return;
    const id = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(id);
  }, [poll, polling]);

  const chartData = useMemo(
    () =>
      samples.map((s, i) => ({
        i,
        down: (s.down * 8) / 1_000_000,
        up: (s.up * 8) / 1_000_000,
      })),
    [samples],
  );

  const yMax = useMemo(() => {
    if (chartData.length === 0) return 1;
    const peak = Math.max(0, ...chartData.flatMap((d) => [d.down, d.up]));
    if (peak <= 0) return 1;
    const steps = [0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000];
    for (const s of steps) {
      if (peak <= s * 0.92) return s;
    }
    return Math.ceil(peak / 100) * 100;
  }, [chartData]);

  const latest = samples[samples.length - 1];

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="h-8"
          variant="outline"
          size="sm"
          onClick={() => setPolling((p) => !p)}
        >
          {polling ? (
            <Pause className="mr-1.5 size-3.5" />
          ) : (
            <Play className="mr-1.5 size-3.5" />
          )}
          {polling ? t("network.trafficPause") : t("network.trafficResume")}
        </Button>
        <Button
          className="h-8"
          variant="outline"
          size="sm"
          onClick={poll}
          disabled={busy}
        >
          <RefreshCw
            className={cn("mr-1.5 size-3.5", busy && "animate-spin")}
          />
          {t("network.refresh")}
        </Button>
        {latest && (
          <span className="text-xs text-muted-foreground">
            ↓ {fmtRate(latest.down)} · ↑ {fmtRate(latest.up)}
          </span>
        )}
      </div>

      <div className="h-44 shrink-0 rounded-md border border-border bg-card p-2">
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("network.trafficCollecting")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={160}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis dataKey="i" hide />
              <YAxis
                width={48}
                domain={[0, yMax]}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) =>
                  yMax < 1
                    ? Number(v).toFixed(2)
                    : yMax < 10
                      ? Number(v).toFixed(1)
                      : String(Math.round(Number(v)))
                }
                label={{
                  value: "Mbps",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "var(--muted-foreground)" },
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value) => [
                  fmtRate((Number(value) * 1_000_000) / 8),
                  undefined,
                ]}
              />
              <Line
                type="monotone"
                dataKey="down"
                name={t("network.trafficDown")}
                stroke="var(--chart-1)"
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="up"
                name={t("network.trafficUp")}
                stroke="var(--chart-2)"
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t("network.ifaceName")}</TableHead>
              <TableHead>{t("network.trafficRx")}</TableHead>
              <TableHead>{t("network.trafficTx")}</TableHead>
              <TableHead>{t("network.trafficRate")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ifaces.map((row) => {
              const rate = rates[row.name];
              return (
                <TableRow key={row.name}>
                  <TableCell className="font-mono text-sm">
                    {row.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {fmtBytes(row.receivedBytes)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {fmtBytes(row.transmittedBytes)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {rate ? `↓${fmtRate(rate.rx)} ↑${fmtRate(rate.tx)}` : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
