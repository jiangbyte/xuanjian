/**
 * @file 终端左侧边栏
 * @author Charlie
 * @description 左侧图标轨切换文件、脚本、历史、概览、进程、端口、Docker 等面板。
 * 文件标签复用 TerminalSidePanel；其余对应 panes 子目录组件。
 * 需传入当前会话 sessionId / kind，供各子面板探测远程或本地环境。
 */

import {
  Activity,
  Clock3,
  Container,
  FolderOpen,
  ListTodo,
  Network,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DockerPane } from "@/features/terminal/panes/DockerPane";
import { HistoryPane } from "@/features/terminal/panes/HistoryPane";
import { OverviewPane } from "@/features/terminal/panes/OverviewPane";
import { PortsPane } from "@/features/terminal/panes/PortsPane";
import { ProcessesPane } from "@/features/terminal/panes/ProcessesPane";
import { ScriptsPane } from "@/features/terminal/panes/ScriptsPane";
import { TerminalSidePanel } from "@/features/terminal/TerminalSidePanel";
import { cn } from "@/lib/utils";

/** 左侧边栏可选标签 ID */
export type LeftTabId =
  | "files"
  | "scripts"
  | "history"
  | "overview"
  | "processes"
  | "ports"
  | "docker";

/**
 * 终端左侧栏：图标轨 + 对应功能面板内容区。
 */
export function TerminalLeftPanel({
  sessionId,
  kind,
  hostId,
  shellId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  hostId?: number | null;
  shellId?: string | null;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LeftTabId>("files");

  const tabs = useMemo(
    () =>
      [
        { id: "files" as const, icon: FolderOpen, label: t("termTab.files") },
        { id: "scripts" as const, icon: Zap, label: t("termTab.scripts") },
        { id: "history" as const, icon: Clock3, label: t("termTab.history") },
        {
          id: "overview" as const,
          icon: Activity,
          label: t("termTab.overview"),
        },
        {
          id: "processes" as const,
          icon: ListTodo,
          label: t("termTab.processes"),
        },
        { id: "ports" as const, icon: Network, label: t("termTab.ports") },
        { id: "docker" as const, icon: Container, label: t("termTab.docker") },
      ] as const,
    [t],
  );

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* —— 左侧图标轨 —— */}
      <nav
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2"
        aria-label={t("termTab.rail")}
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
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* —— 当前标签内容 —— */}
      <div className="h-full min-w-0 flex-1 overflow-hidden">
        {tab === "files" && (
          <TerminalSidePanel
            sessionId={sessionId}
            kind={kind}
            hostId={hostId}
          />
        )}
        {tab === "scripts" && <ScriptsPane sessionId={sessionId} />}
        {tab === "history" && <HistoryPane sessionId={sessionId} />}
        {tab === "overview" && (
          <OverviewPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
        {tab === "processes" && (
          <ProcessesPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
        {tab === "ports" && (
          <PortsPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
        {tab === "docker" && (
          <DockerPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
      </div>
    </div>
  );
}
