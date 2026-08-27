/**
 * @file 连通性探测面板
 * @author Charlie
 * @description Ping / Traceroute；目标与数据均互不共用。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PingPage } from "./connectivity/PingPage";
import { TracePage } from "./connectivity/TracePage";

const MODES = ["ping", "traceroute"] as const;
type Mode = (typeof MODES)[number];

/** 壳：模式切换 + 常驻两页（隐藏不卸载，保留各自状态） */
export function ConnectivityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("ping");

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
            {t(`network.${m === "traceroute" ? "traceroute" : m}`)}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "ping" && "hidden",
        )}
      >
        <PingPage />
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "traceroute" && "hidden",
        )}
      >
        <TracePage />
      </div>
    </div>
  );
}
