/**
 * @file 网络工具控制台壳
 * @author Charlie
 * @description 配置信息、连通性、DNS、端口连接、性能流量、历史。
 */

import {
  Activity,
  Cable,
  History,
  Network,
  Radar,
  Search,
  Settings2,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const InfoPanel = lazy(() =>
  import("@/features/network/panels/InfoPanel").then((m) => ({
    default: m.InfoPanel,
  })),
);
const ConnectivityPanel = lazy(() =>
  import("@/features/network/panels/ConnectivityPanel").then((m) => ({
    default: m.ConnectivityPanel,
  })),
);
const DnsPanel = lazy(() =>
  import("@/features/network/panels/DnsPanel").then((m) => ({
    default: m.DnsPanel,
  })),
);
const PortsConnectionsPanel = lazy(() =>
  import("@/features/network/panels/PortsConnectionsPanel").then((m) => ({
    default: m.PortsConnectionsPanel,
  })),
);
const PerformancePanel = lazy(() =>
  import("@/features/network/panels/PerformancePanel").then((m) => ({
    default: m.PerformancePanel,
  })),
);
const NetworkHistoryPanel = lazy(() =>
  import("@/features/network/NetworkHistoryPanel").then((m) => ({
    default: m.NetworkHistoryPanel,
  })),
);

type TabId =
  | "info"
  | "connectivity"
  | "dns"
  | "ports"
  | "performance"
  | "history";

const TABS: { id: TabId; icon: typeof Network; labelKey: string }[] = [
  { id: "info", icon: Settings2, labelKey: "network.info" },
  { id: "connectivity", icon: Radar, labelKey: "network.connectivity" },
  { id: "dns", icon: Search, labelKey: "network.dnsTitle" },
  { id: "ports", icon: Cable, labelKey: "network.portsConn" },
  { id: "performance", icon: Activity, labelKey: "network.performance" },
  { id: "history", icon: History, labelKey: "networkHistory.title" },
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
  const [tab, setTab] = useState<TabId>("info");

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
      <main className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <Suspense fallback={<PanelFallback />}>
          {tab === "info" && <InfoPanel />}
          {tab === "connectivity" && <ConnectivityPanel />}
          {tab === "dns" && <DnsPanel />}
          {tab === "ports" && <PortsConnectionsPanel />}
          {tab === "performance" && <PerformancePanel />}
          {tab === "history" && <NetworkHistoryPanel />}
        </Suspense>
      </main>
    </div>
  );
}
