/**
 * @file Traceroute 跳点路径可视化
 * @author Charlie
 */

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TraceHop } from "./types";

function fmtRtt(v: number | null | undefined) {
  if (v == null) return "*";
  return v < 10 ? `${v.toFixed(1)}` : `${Math.round(v)}`;
}

/** 纵向 hop 列表 */
export function TraceViz({
  hops,
  busy,
  target,
}: {
  hops: TraceHop[];
  busy: boolean;
  target: string;
}) {
  const { t } = useTranslation();

  if (hops.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
        {busy ? t("network.running") : t("network.vizEmpty")}
      </div>
    );
  }

  const last = hops[hops.length - 1];
  const reached =
    !!target &&
    !!last &&
    !last.rtts.every((r) => r == null) &&
    [last.host, last.ip].some(
      (x) => x && x.toLowerCase().includes(target.trim().toLowerCase()),
    );

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-3">
      <ol className="flex flex-col gap-0">
        <li className="flex items-start gap-3 pb-3">
          <div className="flex w-8 flex-col items-center">
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
              0
            </span>
            <span className="mt-1 w-px flex-1 min-h-4 bg-border" />
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="text-xs font-medium">{t("network.hopLocal")}</div>
            <div className="text-[11px] text-muted-foreground">{t("network.hopStart")}</div>
          </div>
        </li>
        {hops.map((h, i) => {
          const lost = h.rtts.length > 0 && h.rtts.every((r) => r == null);
          const isLast = i === hops.length - 1;
          const highlight = isLast && reached;
          return (
            <li key={h.hop} className="flex items-start gap-3 pb-3 last:pb-0">
              <div className="flex w-8 flex-col items-center">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-[10px] font-medium",
                    highlight
                      ? "bg-primary text-primary-foreground"
                      : lost
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-foreground",
                  )}
                >
                  {h.hop}
                </span>
                {!isLast && <span className="mt-1 w-px flex-1 min-h-4 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="truncate text-xs font-medium">
                  {h.host || h.ip || (lost ? t("network.timeout") : "—")}
                </div>
                {h.host && h.ip && (
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {h.ip}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[11px] text-muted-foreground">
                  {h.rtts.map((r, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "rounded-sm bg-muted/60 px-1.5 py-0.5",
                        r == null && "text-destructive",
                      )}
                    >
                      {fmtRtt(r)}
                      {r != null ? " ms" : ""}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
