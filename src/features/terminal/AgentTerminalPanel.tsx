/**
 * @file Agent 下栏终端面板
 * @description 多标签 xterm，供 Agent 与用户同屏观测命令执行。
 */

import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { XtermView } from "@/features/terminal/XtermView";
import {
  agentTabAsTermTab,
  ensureAgentTerminal,
} from "@/lib/session/agentTerminal";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

export function AgentTerminalPanel({
  workspaceActive,
  collapsed = false,
}: {
  workspaceActive: boolean;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const agentTabs = useUiStore((s) => s.agentTabs);
  const activeAgentTabId = useUiStore((s) => s.activeAgentTabId);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const tabs = useUiStore((s) => s.tabs);
  const setActiveAgentTab = useUiStore((s) => s.setActiveAgentTab);
  const closeAgentTab = useUiStore((s) => s.closeAgentTab);
  const toggleBottomPanel = useUiStore((s) => s.toggleBottomPanel);

  const parentTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const headerTabs = activeTabId
    ? agentTabs.filter((tab) => tab.parentTabId === activeTabId)
    : agentTabs;
  const mountedTabs = agentTabs;

  const addTab = async () => {
    if (!parentTab) return;
    try {
      await ensureAgentTerminal(parentTab, { forceNew: true });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {collapsed ? (
        <button
          type="button"
          className="flex h-full w-full shrink-0 items-center justify-center gap-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground hover:bg-muted/50"
          onClick={toggleBottomPanel}
        >
          <ChevronUp size={13} />
          <span>
            {t("terminal.agentPanel")}
            {headerTabs.length > 0 ? ` (${headerTabs.length})` : ""}
          </span>
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {t("terminal.agentPanel")}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {headerTabs.length === 0 ? (
              <span className="truncate px-1 text-xs text-muted-foreground">
                {t("terminal.agentPanelEmpty")}
              </span>
            ) : (
              headerTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    "group flex max-w-[160px] shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs",
                    tab.id === activeAgentTabId
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => setActiveAgentTab(tab.id)}
                >
                  <span className="truncate">{tab.title}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    className="rounded p-0.5 opacity-0 hover:bg-background/60 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeAgentTab(tab.id);
                    }}
                  >
                    <X size={11} />
                  </span>
                </button>
              ))
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={!parentTab}
                aria-label={t("terminal.newAgentTab")}
                onClick={() => addTab().catch(console.error)}
              >
                <Plus size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("terminal.newAgentTab")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={t("terminal.collapseBottom")}
                onClick={toggleBottomPanel}
              >
                <ChevronDown size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("terminal.collapseBottom")}</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div
        className={cn(
          "relative min-h-0 overflow-hidden",
          collapsed ? "h-0" : "flex-1",
        )}
      >
        {headerTabs.length === 0 && mountedTabs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {t("terminal.agentPanelHint")}
          </div>
        ) : (
          mountedTabs.map((tab) => {
            const visibleForParent =
              !activeTabId || tab.parentTabId === activeTabId;
            const isActiveAgent =
              tab.id === activeAgentTabId && visibleForParent;
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{
                  visibility: isActiveAgent ? "visible" : "hidden",
                  pointerEvents: isActiveAgent ? "auto" : "none",
                  zIndex: isActiveAgent ? 1 : 0,
                }}
              >
                <XtermView
                  tab={agentTabAsTermTab(tab)}
                  active={workspaceActive && isActiveAgent}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
