/**
 * @file 终端右侧边栏
 * @author Charlie
 * @description 右侧窄轨切换 AI 对话与笔记两个面板。
 * AI 面板为占位实现；笔记面板对接本地数据库。
 * 轨按钮位于最右侧，内容区占满剩余宽度。
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

/** 右侧边栏标签：AI（占位）或笔记 */
export type RightTabId = "ai" | "notes";

/**
 * 终端右侧栏：在 AI 占位面板与笔记面板间切换。
 */
export function TerminalRightPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RightTabId>("ai");

  const tabs = useMemo(
    () =>
      [
        { id: "ai" as const, icon: Sparkles, label: t("termTab.ai") },
        { id: "notes" as const, icon: NotebookPen, label: t("termTab.notes") },
      ] as const,
    [t],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* —— 面板内容 —— */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {tab === "ai" && <AiChatPanel />}
        {tab === "notes" && <NotesPane />}
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
                  onClick={() => setTab(item.id)}
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
