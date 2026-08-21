/**
 * @file 网络工具控制台壳
 * @author Charlie
 * @description 左侧导航切换连通性、IP 计算、端口、HTTP、测速等子面板。
 * 子面板按需懒加载，避免一次拉入 recharts / xyflow。
 */

import {
  Calculator,
  Gauge,
  Globe2,
  Network,
  Radar,
  ScanSearch,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const ConnectivityPanel = lazy(() =>
  import("@/features/network/panels/ConnectivityPanel").then((m) => ({
    default: m.ConnectivityPanel,
  })),
);
const IpCalcPanel = lazy(() =>
  import("@/features/network/panels/IpCalcPanel").then((m) => ({
    default: m.IpCalcPanel,
  })),
);
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
const SpeedTestPanel = lazy(() =>
  import("@/features/network/panels/SpeedTestPanel").then((m) => ({
    default: m.SpeedTestPanel,
  })),
);

type TabId = "connectivity" | "ipCalc" | "ports" | "http" | "speedTest";

const TABS: { id: TabId; icon: typeof Network; labelKey: string }[] = [
  { id: "connectivity", icon: Radar, labelKey: "network.connectivity" },
  { id: "ipCalc", icon: Calculator, labelKey: "network.ipCalc" },
  { id: "ports", icon: ScanSearch, labelKey: "network.ports" },
  { id: "http", icon: Globe2, labelKey: "network.http" },
  { id: "speedTest", icon: Gauge, labelKey: "network.speedTest" },
];

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      …
    </div>
  );
}

/** 网络工具主控制台：侧栏 + 当前子面板 */
export function NetworkConsole() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("connectivity");

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-2 py-2">
          <Network size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-sidebar-foreground">
            {t("network.title")}
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-1">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon size={15} />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-background">
        <Suspense fallback={<PanelFallback />}>
          {tab === "connectivity" && <ConnectivityPanel />}
          {tab === "ipCalc" && <IpCalcPanel />}
          {tab === "ports" && <PortsPanel />}
          {tab === "http" && <HttpPanel />}
          {tab === "speedTest" && <SpeedTestPanel />}
        </Suspense>
      </main>
    </div>
  );
}
