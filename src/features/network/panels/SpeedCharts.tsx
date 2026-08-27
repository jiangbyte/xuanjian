/**
 * @file 测速图表（ECharts）
 */

import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

function gaugeMax(value: number) {
  if (value <= 0) return 100;
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000];
  for (const s of steps) {
    if (value <= s * 0.92) return s;
  }
  return Math.ceil(value / 500) * 500;
}

function lineMax(data: { mbps: number }[]) {
  if (data.length === 0) return 10;
  const peak = Math.max(0, ...data.map((d) => d.mbps));
  if (peak <= 0) return 10;
  const steps = [1, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const s of steps) {
    if (peak <= s * 0.92) return s;
  }
  return Math.ceil(peak / 100) * 100;
}

function fmtMbps(value: number) {
  if (value <= 0) return "0.00";
  if (value < 10) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return Math.round(value).toString();
}

function cssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

type SpeedGaugeProps = {
  label: string;
  value: number;
  color: string;
  unit?: string;
  /** 与对侧仪表共用刻度上限 */
  max?: number;
  /** 当前是否正在测速（非活跃时保持结果、略微淡化） */
  active?: boolean;
};

/** ECharts 汽车仪表盘式半圆速度表（指针随数值动画） */
export function SpeedGauge({
  label,
  value,
  color,
  unit = "Mbps",
  max: maxOverride,
  active = true,
}: SpeedGaugeProps) {
  const max =
    maxOverride != null && maxOverride > 0
      ? gaugeMax(maxOverride)
      : gaugeMax(value);
  const safe = Math.max(0, value);
  const ratio = Math.min(1, safe / max);
  const gaugeColor =
    !active && safe <= 0 ? cssVar("--muted-foreground", "#9ca3af") : color;

  const option = useMemo<EChartsOption>(() => {
    const track = cssVar("--muted", "#e5e7eb");
    const labelColor = cssVar("--muted-foreground", "#6b7280");
    const fg = cssVar("--foreground", "#111827");

    return {
      animation: true,
      animationDurationUpdate: 280,
      animationEasingUpdate: "cubicOut",
      series: [
        {
          type: "gauge",
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max,
          radius: "95%",
          center: ["50%", "58%"],
          progress: {
            show: true,
            width: 10,
            roundCap: true,
            itemStyle: { color: gaugeColor },
          },
          pointer: {
            show: true,
            length: "58%",
            width: 4,
            itemStyle: {
              color: gaugeColor,
              shadowBlur: active ? 4 : 0,
              shadowColor: "rgba(0,0,0,0.15)",
            },
          },
          anchor: {
            show: true,
            size: 10,
            itemStyle: {
              color: gaugeColor,
              borderWidth: 2,
              borderColor: track,
            },
          },
          axisLine: {
            roundCap: true,
            lineStyle: {
              width: 10,
              color: [
                [ratio, gaugeColor],
                [1, track],
              ],
            },
          },
          axisTick: { show: false },
          splitLine: {
            show: true,
            length: 6,
            distance: 4,
            lineStyle: { color: labelColor, width: 1 },
          },
          axisLabel: {
            show: true,
            distance: 14,
            color: labelColor,
            fontSize: 10,
            formatter: (v: number) => (v >= 100 ? `${v}` : `${v}`),
          },
          title: { show: false },
          detail: {
            show: true,
            valueAnimation: true,
            fontSize: 22,
            fontWeight: 600,
            color: fg,
            offsetCenter: [0, "32%"],
            formatter: () => `${fmtMbps(safe)}\n{unit|${unit}}`,
            rich: {
              unit: {
                fontSize: 11,
                fontWeight: 400,
                color: labelColor,
                lineHeight: 18,
              },
            },
          },
          data: [{ value: safe }],
        },
      ],
    };
  }, [active, gaugeColor, max, ratio, safe, unit]);

  return (
    <div className="w-full">
      <ReactECharts
        option={option}
        style={{ height: 168, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
        lazyUpdate={false}
      />
      <div className="-mt-1 text-center text-sm font-medium text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

type SpeedLinePoint = { i: number; mbps: number };

type SpeedLineChartProps = {
  data: SpeedLinePoint[];
  color: string;
  label: string;
  emptyHint?: string;
  className?: string;
};

/** ECharts 实时速度折线 */
export function SpeedLineChart({
  data,
  color,
  label,
  emptyHint = "—",
  className,
}: SpeedLineChartProps) {
  const ymax = lineMax(data);

  const option = useMemo<EChartsOption>(() => {
    const labelColor = cssVar("--muted-foreground", "#6b7280");
    const border = cssVar("--border", "#e5e7eb");
    const popover = cssVar("--popover", "#ffffff");

    return {
      animation: false,
      grid: { top: 12, right: 12, bottom: 8, left: 40 },
      tooltip: {
        trigger: "axis",
        backgroundColor: popover,
        borderColor: border,
        textStyle: { fontSize: 12, color: labelColor },
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params;
          if (!p || p.value == null) return "";
          return `${label}: ${Number(p.value).toFixed(2)} Mbps`;
        },
      },
      xAxis: {
        type: "category",
        show: false,
        data: data.map((d) => d.i),
      },
      yAxis: {
        type: "value",
        min: 0,
        max: ymax,
        splitLine: { lineStyle: { type: "dashed", color: border } },
        axisLabel: {
          color: labelColor,
          fontSize: 10,
          formatter: (v: number) => `${v}M`,
        },
      },
      series: [
        {
          type: "line",
          name: label,
          data: data.map((d) => d.mbps),
          smooth: 0.35,
          showSymbol: false,
          lineStyle: { width: 2, color },
          areaStyle: {
            color,
            opacity: 0.22,
          },
        },
      ],
    };
  }, [color, data, label, ymax]);

  if (data.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-border/60 bg-muted/20 text-xs text-muted-foreground",
          className ?? "h-[150px]",
        )}
      >
        {emptyHint}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full rounded-md border border-border/60 bg-card/50 p-1",
        className ?? "h-[150px]",
      )}
    >
      <ReactECharts
        option={option}
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}

/** @deprecated 使用 SpeedGauge */
export const SpeedRadialGauge = SpeedGauge;
