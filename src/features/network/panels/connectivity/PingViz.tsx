/**
 * @file Ping 统计卡 + 延迟折线 + 包状态条
 * @author Charlie
 */

import { useMemo } from "react";
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
import { cn } from "@/lib/utils";
import { derivePingStats, type PingSample, type PingSummary } from "./types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs" title={value}>
        {value}
      </div>
    </div>
  );
}

function fmtMs(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

function fmtPct(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(v > 0 && v < 1 ? 1 : 0)}%`;
}

/** Ping 可视化主区域 */
export function PingViz({
  samples,
  summary,
  busy,
}: {
  samples: PingSample[];
  summary: PingSummary | null;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const stats = useMemo(
    () => derivePingStats(samples, summary),
    [samples, summary],
  );

  const chartData = useMemo(
    () =>
      samples.map((s) => ({
        seq: s.seq,
        rtt: s.rttMs,
        lost: s.rttMs == null,
      })),
    [samples],
  );

  const empty = samples.length === 0 && !summary;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Stat label={t("network.statMin")} value={fmtMs(stats.minMs)} />
        <Stat label={t("network.statAvg")} value={fmtMs(stats.avgMs)} />
        <Stat label={t("network.statMax")} value={fmtMs(stats.maxMs)} />
        <Stat label={t("network.statLoss")} value={fmtPct(stats.lossPct)} />
      </div>

      <div className="min-h-0 flex-1 rounded-md border border-border bg-card p-2">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {busy ? t("network.running") : t("network.vizEmpty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="seq"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={40}
                unit="ms"
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(seq) => `#${seq}`}
                formatter={(value, _name, item) => {
                  const lost = (item?.payload as { lost?: boolean } | undefined)?.lost;
                  if (lost || value == null) return [t("network.timeout"), t("network.rtt")];
                  return [`${Number(value).toFixed(1)} ms`, t("network.rtt")];
                }}
              />
              <Line
                type="monotone"
                dataKey="rtt"
                stroke="var(--primary)"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {samples.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-0.5">
          {samples.map((s) => (
            <span
              key={`${s.seq}-${s.at}`}
              title={
                s.rttMs == null
                  ? `#${s.seq} ${t("network.timeout")}`
                  : `#${s.seq} ${s.rttMs.toFixed(1)} ms`
              }
              className={cn(
                "h-2 w-2 rounded-sm",
                s.rttMs == null ? "bg-destructive/70" : "bg-primary/70",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
