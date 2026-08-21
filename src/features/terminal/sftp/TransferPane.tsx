/**
 * @file SFTP 单侧传输面板
 * @author Charlie
 * @description 管理一侧的标签栏，并在激活标签下渲染目录浏览器。
 */

import { Computer, Plus, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HostRow } from "@/lib/db";
import type { SftpEntry } from "@/lib/tauri";
import type { PaneTab, Side, SideSnapshot } from "@/features/terminal/sftp/types";
import { PaneBrowser } from "@/features/terminal/sftp/PaneBrowser";

/** 单侧面板：标签栏 + PaneBrowser */
export function TransferPane({
  side: _side,
  tabs,
  activeTabId,
  hosts,
  onActivate,
  onCloseTab,
  onAdd,
  snapshotRef,
  onTransferEntry,
}: {
  side: Side;
  tabs: PaneTab[];
  activeTabId: string | null;
  hosts: HostRow[];
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAdd: () => void;
  snapshotRef: React.MutableRefObject<SideSnapshot | null>;
  onTransferEntry: (entries: SftpEntry[]) => void;
}) {
  const { t } = useTranslation();
  void _side;
  const active = tabs.find((x) => x.id === activeTabId) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="flex items-center gap-0.5 border-b border-[var(--border)] px-1 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-chip group ${activeTabId === tab.id ? "active" : ""}`}
              onClick={() => onActivate(tab.id)}
            >
              {tab.kind === "local" ? (
                <Computer size={12} />
              ) : (
                <Server size={12} />
              )}
              <span className="truncate">{tab.label}</span>
              <span
                className="icon-btn icon-btn-sm opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <button
          className="icon-btn icon-btn-sm"
          onClick={onAdd}
          title={t("terminal.pickHost")}
        >
          <Plus size={14} />
        </button>
      </div>

      {!active ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <div className="text-sm muted">{t("terminal.pickHostFirst")}</div>
          <button className="btn btn-primary" onClick={onAdd}>
            <Plus size={14} />
            {t("terminal.pickHost")}
          </button>
        </div>
      ) : (
        <PaneBrowser
          key={active.id}
          tab={active}
          hosts={hosts}
          snapshotRef={snapshotRef}
          onTransferEntry={onTransferEntry}
        />
      )}
    </div>
  );
}
