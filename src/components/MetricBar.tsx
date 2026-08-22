/**
 * @file 指标进度条
 * @author Charlie
 */

import { cn } from "@/lib/utils";

function tone(pct: number) {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 75) return "bg-amber-500";
  return "bg-primary";
}

/** 单行百分比进度条（CPU / 内存 / 磁盘） */
export function MetricBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("flex min-w-[88px] items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden bg-muted">
        <div
          className={cn("h-full transition-all", tone(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
