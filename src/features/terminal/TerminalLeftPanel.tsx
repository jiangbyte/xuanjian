/**
 * @file 终端左侧边栏
 * @author Charlie
 * @description 左侧图标轨切换文件、脚本、历史、概览、进程、端口、Docker 等面板。
 * 已访问过的面板 keep-alive（隐藏不卸载），避免切换后状态丢失。
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
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TerminalSidePanel } from "@/features/terminal/TerminalSidePanel";
import { cn } from "@/lib/utils";

const ScriptsPane = lazy(() =>
  import("@/features/terminal/panes/ScriptsPane").then((m) => ({
    default: m.ScriptsPane,
  })),
);
const HistoryPane = lazy(() =>
  import("@/features/terminal/panes/HistoryPane").then((m) => ({
    default: m.HistoryPane,
  })),
);
const OverviewPane = lazy(() =>
  import("@/features/terminal/panes/OverviewPane").then((m) => ({
    default: m.OverviewPane,
  })),
);
const ProcessesPane = lazy(() =>
  import("@/features/terminal/panes/ProcessesPane").then((m) => ({
    default: m.ProcessesPane,
  })),
);
const PortsPane = lazy(() =>
  import("@/features/terminal/panes/PortsPane").then((m) => ({
    default: m.PortsPane,
  })),
);
const DockerPane = lazy(() =>
  import("@/features/terminal/panes/DockerPane").then((m) => ({
    default: m.DockerPane,
  })),
);

/** 左侧边栏可选标签 ID */
export type LeftTabId =
  | "files"
  | "scripts"
  | "history"
  | "overview"
  | "processes"
  | "ports"
  | "docker";

function PaneFallback() {
  return <div className="h-full w-full bg-background" aria-hidden />;
}

function KeepAlivePane({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0"
      style={{
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 1 : 0,
      }}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

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
  const [visited, setVisited] = useState<Set<LeftTabId>>(() => new Set(["files"]));

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

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

      <div className="relative h-full min-w-0 flex-1 overflow-hidden">
        <Suspense fallback={<PaneFallback />}>
          {visited.has("files") ? (
            <KeepAlivePane active={tab === "files"}>
              <TerminalSidePanel
                sessionId={sessionId}
                kind={kind}
                hostId={hostId}
                shellId={shellId}
              />
            </KeepAlivePane>
          ) : null}
          {visited.has("scripts") ? (
            <KeepAlivePane active={tab === "scripts"}>
              <ScriptsPane sessionId={sessionId} />
            </KeepAlivePane>
          ) : null}
          {visited.has("history") ? (
            <KeepAlivePane active={tab === "history"}>
              <HistoryPane sessionId={sessionId} />
            </KeepAlivePane>
          ) : null}
          {visited.has("overview") ? (
            <KeepAlivePane active={tab === "overview"}>
              <OverviewPane
                sessionId={sessionId}
                kind={kind}
                hostId={hostId}
                shellId={shellId}
                active={tab === "overview"}
              />
            </KeepAlivePane>
          ) : null}
          {visited.has("processes") ? (
            <KeepAlivePane active={tab === "processes"}>
              <ProcessesPane
                sessionId={sessionId}
                kind={kind}
                shellId={shellId}
              />
            </KeepAlivePane>
          ) : null}
          {visited.has("ports") ? (
            <KeepAlivePane active={tab === "ports"}>
              <PortsPane sessionId={sessionId} kind={kind} shellId={shellId} />
            </KeepAlivePane>
          ) : null}
          {visited.has("docker") ? (
            <KeepAlivePane active={tab === "docker"}>
              <DockerPane sessionId={sessionId} kind={kind} shellId={shellId} />
            </KeepAlivePane>
          ) : null}
        </Suspense>
      </div>
    </div>
  );
}
