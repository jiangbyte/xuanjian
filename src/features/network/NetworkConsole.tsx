/**
 * @file 网络工具控制台壳
 * @author Charlie
 * @description 左侧导航切换连通性、IP 计算、端口、抓包、分析、HTTP、杂项等子面板。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Binary,
  Calculator,
  Globe2,
  Network,
  Radar,
  ScanSearch,
} from "lucide-react";
import { ConnectivityPanel } from "@/features/network/panels/ConnectivityPanel";
import { IpCalcPanel } from "@/features/network/panels/IpCalcPanel";
import { PortsPanel } from "@/features/network/panels/PortsPanel";
import { CapturePanel } from "@/features/network/panels/CapturePanel";
import { AnalysisPanel } from "@/features/network/panels/AnalysisPanel";
import { HttpPanel } from "@/features/network/panels/HttpPanel";
import { UtilsPanel } from "@/features/network/panels/UtilsPanel";

type TabId =
  | "connectivity"
  | "ipCalc"
  | "ports"
  | "capture"
  | "analysis"
  | "http"
  | "utils";

const TABS: { id: TabId; icon: typeof Network; labelKey: string }[] = [
  { id: "connectivity", icon: Radar, labelKey: "network.connectivity" },
  { id: "ipCalc", icon: Calculator, labelKey: "network.ipCalc" },
  { id: "ports", icon: ScanSearch, labelKey: "network.ports" },
  { id: "capture", icon: Activity, labelKey: "network.capture" },
  { id: "analysis", icon: Globe2, labelKey: "network.analysis" },
  { id: "http", icon: Globe2, labelKey: "network.http" },
  { id: "utils", icon: Binary, labelKey: "network.utils" },
];

/** 网络工具主控制台：侧栏 + 当前子面板 */
export function NetworkConsole() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("connectivity");

  return (
    <div className="flex h-full min-h-0">
      {/* —— 侧栏导航 —— */}
      <aside className="flex w-48 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-3">
          <Network size={16} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold">{t("network.title")}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                <Icon size={15} />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
      </aside>
      {/* —— 子面板内容 —— */}
      <main className="min-w-0 flex-1 overflow-hidden bg-[var(--bg)]">
        {tab === "connectivity" && <ConnectivityPanel />}
        {tab === "ipCalc" && <IpCalcPanel />}
        {tab === "ports" && <PortsPanel />}
        {tab === "capture" && <CapturePanel />}
        {tab === "analysis" && <AnalysisPanel />}
        {tab === "http" && <HttpPanel />}
        {tab === "utils" && <UtilsPanel />}
      </main>
    </div>
  );
}
