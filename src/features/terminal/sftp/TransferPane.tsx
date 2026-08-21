/**
 * @file SFTP 单侧传输面板
 * @author Charlie
 * @description 管理一侧的标签栏，并在激活标签下渲染目录浏览器。
 */

import { Computer, Plus, Server, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border">
      <div className="flex shrink-0 items-center gap-0.5 overflow-hidden border-b border-border px-1 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "group inline-flex h-7 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs",
                activeTabId === tab.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => onActivate(tab.id)}
            >
              {tab.kind === "local" ? (
                <Computer size={12} className="shrink-0" />
              ) : (
                <Server size={12} className="shrink-0" />
              )}
              <span className="max-w-[120px] truncate">{tab.label}</span>
              <span
                role="button"
                tabIndex={0}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-muted group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }
                }}
                aria-label={t("context.closeTab")}
              >
                <X size={12} />
              </span>
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          onClick={onAdd}
          title={t("terminal.pickHost")}
        >
          <Plus size={14} />
        </Button>
      </div>

      {!active ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <div className="text-sm text-muted-foreground">
            {t("terminal.pickHostFirst")}
          </div>
          <Button type="button" onClick={onAdd}>
            <Plus size={14} />
            {t("terminal.pickHost")}
          </Button>
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
