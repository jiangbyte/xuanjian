/**
 * @file 标题栏
 * @author Charlie
 * @description 会话标签、侧栏折叠、传输面板入口、设置与窗口控制。
 * 支持拖拽区域（Tauri）；标签右键可重连 / 关闭。
 */

import {
  ArrowDownUp,
  Home,
  PanelLeft,
  PanelRight,
  Plus,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { WindowControls } from "@/components/WindowControls";
import { TransferPanel } from "@/features/terminal/TransferPanel";
import { dialogs } from "@/lib/ui/dialogs";
import { isMacOs } from "@/lib/core/platform";
import { canReconnect, reconnectTermTab } from "@/lib/session/connect";
import { cn } from "@/lib/utils";
import { useTransferStore } from "@/stores/transfer";
import type { TermTab } from "@/stores/ui";
import { useUiStore } from "@/stores/ui";

function tabStatusDotClass(status: TermTab["status"]) {
  switch (status) {
    case "open":
      return "bg-success";
    case "connecting":
      return "animate-pulse bg-primary";
    case "closed":
      return "bg-secondary";
    case "error":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

/**
 * 应用顶栏：标签条 + 终端布局开关 + 传输 / 设置 / 窗口控制。
 * @副作用 切换路由、关闭会话、打开设置与传输面板
 */
export function TitleBar() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const leftCollapsed = useUiStore((s) => s.leftCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightCollapsed);
  const transferOpen = useUiStore((s) => s.transferOpen);
  const toggleLeft = useUiStore((s) => s.toggleLeft);
  const toggleRight = useUiStore((s) => s.toggleRight);
  const setTransferOpen = useUiStore((s) => s.setTransferOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const activeTransfers = useTransferStore(
    (s) =>
      s.jobs.filter(
        (j) =>
          j.status === "running" ||
          j.status === "queued" ||
          j.status === "paused",
      ).length,
  );
  const navigate = useNavigate();
  const location = useLocation();
  const onTerminal = location.pathname === "/terminal";

  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-1.5 overflow-hidden border-b border-border bg-titlebar py-2 pr-2.5",
        isMacOs() ? "pl-[78px]" : "pl-2.5",
      )}
      data-tauri-drag-region
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1"
        data-tauri-drag-region
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate("/")}
          title={t("brand")}
          aria-label={t("brand")}
        >
          <Home size={14} />
        </Button>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden">
          {tabs.map((tab) => {
            const active = activeTabId === tab.id && onTerminal;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group inline-flex h-8 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => {
                  setActiveTab(tab.id);
                  navigate("/terminal");
                }}
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    ...(canReconnect(tab)
                      ? [
                          {
                            id: "reconnect",
                            label: t("terminal.reconnect"),
                            onClick: async () => {
                              const ok = await dialogs.confirm(
                                t("terminal.reconnectConfirm"),
                                {
                                  title: t("terminal.disconnected"),
                                  confirmLabel: t("terminal.reconnect"),
                                  cancelLabel: t("dialog.cancel"),
                                },
                              );
                              if (!ok) return;
                              try {
                                await reconnectTermTab(tab.id);
                              } catch (err) {
                                await dialogs.alert(String(err));
                              }
                            },
                          },
                          "sep" as const,
                        ]
                      : []),
                    {
                      id: "close",
                      label: t("context.closeTab"),
                      onClick: () => {
                        closeTab(tab.id);
                        if (tabs.length <= 1) navigate("/");
                      },
                    },
                    {
                      id: "closeOthers",
                      label: t("context.closeOtherTabs"),
                      disabled: tabs.length <= 1,
                      onClick: () => {
                        tabs
                          .filter((x) => x.id !== tab.id)
                          .forEach((x) => closeTab(x.id));
                        setActiveTab(tab.id);
                        navigate("/terminal");
                      },
                    },
                  ])
                }
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tabStatusDotClass(tab.status),
                  )}
                />
                <span className="max-w-[140px] truncate">{tab.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                    active ? "opacity-70" : "opacity-0 group-hover:opacity-100",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                    if (tabs.length <= 1) navigate("/");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      closeTab(tab.id);
                      if (tabs.length <= 1) navigate("/");
                    }
                  }}
                  aria-label={t("context.closeTab")}
                >
                  ×
                </span>
              </button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setSwitcherOpen(true)}
            title="New session (Ctrl+J)"
            aria-label="New session"
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onTerminal && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-pressed={!leftCollapsed}
              className={cn(
                !leftCollapsed
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              )}
              onClick={toggleLeft}
              title={
                leftCollapsed ? t("terminal.expand") : t("terminal.collapse")
              }
              aria-label={
                leftCollapsed ? t("terminal.expand") : t("terminal.collapse")
              }
            >
              <PanelLeft size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-pressed={!rightCollapsed}
              className={cn(
                !rightCollapsed
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              )}
              onClick={toggleRight}
              title={
                rightCollapsed ? t("terminal.expand") : t("terminal.collapse")
              }
              aria-label={
                rightCollapsed ? t("terminal.expand") : t("terminal.collapse")
              }
            >
              <PanelRight size={14} />
            </Button>
          </>
        )}
        <Popover open={transferOpen} onOpenChange={setTransferOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-pressed={transferOpen}
              className={cn(
                "relative",
                transferOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              )}
              title={t("transfer.title")}
              aria-label={t("transfer.title")}
            >
              <ArrowDownUp size={14} />
              {activeTransfers > 0 && (
                <span className="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  {activeTransfers}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[440px] max-h-[min(360px,calc(100vh-56px))] overflow-hidden p-0"
          >
            <div className="transfer-popover-inner h-[360px] max-h-[calc(100vh-56px)] overflow-hidden">
              <TransferPanel />
            </div>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setSettingsOpen(true)}
          title={t("nav.settings")}
          aria-label={t("nav.settings")}
        >
          <Settings size={14} />
        </Button>
        <WindowControls />
      </div>
    </header>
  );
}
