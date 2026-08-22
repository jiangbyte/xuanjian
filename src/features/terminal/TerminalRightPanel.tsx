/**
 * @file 终端右侧边栏
 * @author Charlie
 * @description 右侧窄轨切换 AI 对话与笔记两个面板。
 * 两面板保持挂载、仅 CSS 隐藏，避免切轨丢失 AI 会话状态。
 */

import { NotebookPen, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AiChatPanel } from "@/features/terminal/AiChatPanel";
import { NotesPane } from "@/features/terminal/panes/NotesPane";
import { cn } from "@/lib/utils";

/** 右侧边栏标签：AI 或笔记 */
export type RightTabId = "ai" | "notes";

const RIGHT_TAB_KEY = "xuanjian.terminal.rightTab";

function loadRightTab(): RightTabId {
  try {
    const v = localStorage.getItem(RIGHT_TAB_KEY);
    if (v === "ai" || v === "notes") return v;
  } catch {
    /* ignore */
  }
  return "ai";
}

function saveRightTab(tab: RightTabId) {
  try {
    localStorage.setItem(RIGHT_TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

/**
 * 终端右侧栏：在 AI 与笔记间切换（保持挂载）。
 */
export function TerminalRightPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RightTabId>(() => loadRightTab());

  const tabs = useMemo(
    () =>
      [
        { id: "ai" as const, icon: Sparkles, label: t("termTab.ai") },
        { id: "notes" as const, icon: NotebookPen, label: t("termTab.notes") },
      ] as const,
    [t],
  );

  const selectTab = (id: RightTabId) => {
    setTab(id);
    saveRightTab(id);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* —— 面板内容：双挂载，切轨不丢状态 —— */}
      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "absolute inset-0 flex flex-col",
            tab !== "ai" && "invisible pointer-events-none",
          )}
          aria-hidden={tab !== "ai"}
        >
          <AiChatPanel />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex flex-col",
            tab !== "notes" && "invisible pointer-events-none",
          )}
          aria-hidden={tab !== "notes"}
        >
          <NotesPane />
        </div>
      </div>

      {/* —— 右侧图标轨 —— */}
      <nav
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-background py-2"
        aria-label={t("termTab.rightRail")}
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={active ? "secondary" : "ghost"}
                  className={cn(!active && "text-muted-foreground")}
                  aria-label={item.label}
                  aria-pressed={active}
                  onClick={() => selectTab(item.id)}
                >
                  <Icon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}
