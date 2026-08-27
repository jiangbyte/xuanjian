/**
 * @file 端口与连接分析
 */

import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ConnectionsPage } from "./ConnectionsPage";

const PortsPanel = lazy(() =>
  import("@/features/network/panels/PortsPanel").then((m) => ({
    default: m.PortsPanel,
  })),
);
const HttpPanel = lazy(() =>
  import("@/features/network/panels/HttpPanel").then((m) => ({
    default: m.HttpPanel,
  })),
);

const MODES = ["tcp", "connections", "http"] as const;
type Mode = (typeof MODES)[number];

/** TCP 探测 + 本机连接 + HTTP/TLS */
export function PortsConnectionsPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("tcp");

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
            {t(`network.portsMode.${m}`)}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "tcp" && "hidden",
        )}
      >
        <Suspense fallback={<PanelFallback />}>
          <PortsPanel embedded />
        </Suspense>
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "connections" && "hidden",
        )}
      >
        <ConnectionsPage />
      </div>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mode !== "http" && "hidden",
        )}
      >
        <Suspense fallback={<PanelFallback />}>
          <HttpPanel embedded />
        </Suspense>
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
