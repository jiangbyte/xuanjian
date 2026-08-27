/**
 * @file 性能与流量监控
 */

import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { TrafficMonitorPage } from "./TrafficMonitorPage";

const SpeedTestPanel = lazy(() =>
  import("@/features/network/panels/SpeedTestPanel").then((m) => ({
    default: m.SpeedTestPanel,
  })),
);

const MODES = ["speed", "traffic"] as const;
type Mode = (typeof MODES)[number];

/** 带宽测速 + 网卡流量 */
export function PerformancePanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("speed");

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-4">
      <div className="inline-flex h-8 w-fit shrink-0 overflow-hidden rounded-md border border-input">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              "h-full px-3 text-sm transition-colors",
              mode === m
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setMode(m)}
          >
            {t(`network.perfMode.${m}`)}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "speed" && "hidden",
        )}
      >
        <Suspense fallback={<PanelFallback />}>
          <SpeedTestPanel embedded />
        </Suspense>
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "traffic" && "hidden",
        )}
      >
        <TrafficMonitorPage />
      </div>
    </div>
  );
}

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      …
    </div>
  );
}
