/**
 * @file 网络工具控制台壳
 * @author Charlie
 * @description 左侧导航切换连通性、IP 计算、端口、HTTP、测速等子面板。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calculator,
  Gauge,
  Globe2,
  Network,
  Radar,
  ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectivityPanel } from "@/features/network/panels/ConnectivityPanel";
import { IpCalcPanel } from "@/features/network/panels/IpCalcPanel";
import { PortsPanel } from "@/features/network/panels/PortsPanel";
import { HttpPanel } from "@/features/network/panels/HttpPanel";
import { SpeedTestPanel } from "@/features/network/panels/SpeedTestPanel";

type TabId =
  | "connectivity"
  | "ipCalc"
  | "ports"
  | "http"
  | "speedTest";

const TABS: { id: TabId; icon: typeof Network; labelKey: string }[] = [
  { id: "connectivity", icon: Radar, labelKey: "network.connectivity" },
  { id: "ipCalc", icon: Calculator, labelKey: "network.ipCalc" },
  { id: "ports", icon: ScanSearch, labelKey: "network.ports" },
  { id: "http", icon: Globe2, labelKey: "network.http" },
  { id: "speedTest", icon: Gauge, labelKey: "network.speedTest" },
];

/** 网络工具主控制台：侧栏 + 当前子面板 */
export function NetworkConsole() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("connectivity");

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-48 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-2 py-2">
          <Network size={16} className="text-sidebar-primary" />
          <span className="text-sm font-semibold text-sidebar-foreground">
            {t("network.title")}
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-1">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60",
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
        {tab === "connectivity" && <ConnectivityPanel />}
        {tab === "ipCalc" && <IpCalcPanel />}
        {tab === "ports" && <PortsPanel />}
        {tab === "http" && <HttpPanel />}
        {tab === "speedTest" && <SpeedTestPanel />}
      </main>
    </div>
  );
}
