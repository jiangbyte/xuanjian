/**
 * @file 终端三栏工作区
 * @author Charlie
 * @description 布局：左侧工具栏 | 中央 xterm | 右侧 AI；用 shadcn Resizable 调宽。
 * 拖拽中只写 ref / body class，松手再 persist，避免 Zustand 重渲染打断拖动手势。
 */

import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useGroupRef } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { XtermView } from "@/features/terminal/XtermView";
import { AgentTerminalPanel } from "@/features/terminal/AgentTerminalPanel";
import { handleSessionClosed } from "@/lib/session/connect";
import { onSessionClosed } from "@/lib/tauri";
import { type TermTab, useUiStore } from "@/stores/ui";

/** 收起时下栏标题条约占父级高度百分比 */
const COLLAPSED_AGENT_PCT = 4;

const TerminalLeftPanel = lazy(() =>
  import("@/features/terminal/TerminalLeftPanel").then((m) => ({
    default: m.TerminalLeftPanel,
  })),
);
const TerminalRightPanel = lazy(() =>
  import("@/features/terminal/TerminalRightPanel").then((m) => ({
    default: m.TerminalRightPanel,
  })),
);

function MainTerminalStack({
  tabs,
  activeTabId,
  workspaceActive,
  emptyLabel,
}: {
  tabs: TermTab[];
  activeTabId: string | null;
  workspaceActive: boolean;
  emptyLabel: string;
}) {
  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="absolute inset-0"
          style={{
            visibility: tab.id === activeTabId ? "visible" : "hidden",
            pointerEvents: tab.id === activeTabId ? "auto" : "none",
            zIndex: tab.id === activeTabId ? 1 : 0,
          }}
        >
          <XtermView
            tab={tab}
            active={workspaceActive && tab.id === activeTabId}
          />
        </div>
      ))}
    </>
  );
}

/**
 * 终端主工作区：左栏 + 多标签 xterm + 右栏。
 * @param workspaceActive 是否在终端页可见；离页时 xterm 降活跃，右栏仍挂载以保留 AI 会话。
 */
export function TerminalWorkspace({
  workspaceActive = true,
}: {
  workspaceActive?: boolean;
}) {
  const { t } = useTranslation();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const leftCollapsed = useUiStore((s) => s.leftCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightCollapsed);
  const leftWidth = useUiStore((s) => s.leftWidth);
  const rightWidth = useUiStore((s) => s.rightWidth);
  const bottomPanelCollapsed = useUiStore((s) => s.bottomPanelCollapsed);
  const bottomPanelSize = useUiStore((s) => s.bottomPanelSize);
  const setBottomPanelSize = useUiStore((s) => s.setBottomPanelSize);
  const setLeftWidth = useUiStore((s) => s.setLeftWidth);
  const setRightWidth = useUiStore((s) => s.setRightWidth);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const leftPx = useRef(leftWidth);
  const rightPx = useRef(rightWidth);
  const bottomPct = useRef(bottomPanelSize);
  const dragging = useRef(false);
  const verticalDragging = useRef(false);
  const verticalGroupRef = useGroupRef();

  useEffect(() => {
    leftPx.current = leftWidth;
  }, [leftWidth]);
  useEffect(() => {
    rightPx.current = rightWidth;
  }, [rightWidth]);
  useEffect(() => {
    bottomPct.current = bottomPanelSize;
  }, [bottomPanelSize]);

  useEffect(() => {
    const group = verticalGroupRef.current;
    if (!group) return;
    requestAnimationFrame(() => {
      if (bottomPanelCollapsed) {
        group.setLayout({
          "main-term": 100 - COLLAPSED_AGENT_PCT,
          "agent-term": COLLAPSED_AGENT_PCT,
        });
        return;
      }
      group.setLayout({
        "main-term": 100 - bottomPanelSize,
        "agent-term": bottomPanelSize,
      });
    });
  }, [bottomPanelCollapsed, bottomPanelSize, verticalGroupRef]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onSessionClosed((p) => {
      handleSessionClosed(p.sessionId);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
      document.body.classList.remove("is-pane-resizing");
      document.body.classList.remove("is-pane-resizing-vertical");
    };
  }, []);

  const beginHorizontalDrag = () => {
    if (dragging.current) return;
    dragging.current = true;
    document.body.classList.add("is-pane-resizing");
  };

  const beginVerticalDrag = () => {
    if (verticalDragging.current) return;
    verticalDragging.current = true;
    document.body.classList.add("is-pane-resizing");
    document.body.classList.add("is-pane-resizing-vertical");
  };

  const endHorizontalDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.classList.remove("is-pane-resizing");
  };

  const endVerticalDrag = () => {
    if (!verticalDragging.current) return;
    verticalDragging.current = false;
    document.body.classList.remove("is-pane-resizing");
    document.body.classList.remove("is-pane-resizing-vertical");
  };

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full min-w-0"
      onLayoutChange={beginHorizontalDrag}
      onLayoutChanged={(_layout, meta) => {
        endHorizontalDrag();
        if (!meta.isUserInteraction) return;
        if (!leftCollapsed) {
          setLeftWidth(Math.round(leftPx.current), { persist: true });
        }
        if (!rightCollapsed) {
          setRightWidth(Math.round(rightPx.current), { persist: true });
        }
      }}
    >
      {workspaceActive && !leftCollapsed && (
        <>
          <ResizablePanel
            id="left"
            defaultSize={leftWidth}
            minSize={260}
            maxSize={640}
            className="overflow-hidden bg-sidebar"
            onResize={(size) => {
              leftPx.current = size.inPixels;
            }}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  …
                </div>
              }
            >
              <TerminalLeftPanel
                sessionId={activeTab?.sessionId ?? null}
                kind={activeTab?.kind ?? null}
                hostId={activeTab?.hostId ?? null}
                shellId={activeTab?.shellId ?? null}
              />
            </Suspense>
          </ResizablePanel>
          <ResizableHandle />
        </>
      )}

      <ResizablePanel
        id="center"
        minSize={200}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      >
        <ResizablePanelGroup
          id="center-vertical"
          groupRef={verticalGroupRef}
          orientation="vertical"
          className="min-h-0 flex-1"
          defaultLayout={{
            "main-term": bottomPanelCollapsed
              ? 100 - COLLAPSED_AGENT_PCT
              : 100 - bottomPanelSize,
            "agent-term": bottomPanelCollapsed
              ? COLLAPSED_AGENT_PCT
              : bottomPanelSize,
          }}
          onLayoutChange={beginVerticalDrag}
          onLayoutChanged={(layout, meta) => {
            endVerticalDrag();
            if (!meta.isUserInteraction || bottomPanelCollapsed) return;
            const next = layout["agent-term"];
            if (typeof next === "number") {
              setBottomPanelSize(Math.round(next), { persist: true });
            }
          }}
        >
          <ResizablePanel
            id="main-term"
            defaultSize={String(
              bottomPanelCollapsed
                ? 100 - COLLAPSED_AGENT_PCT
                : 100 - bottomPanelSize,
            )}
            minSize="30"
            className="min-h-0 overflow-hidden"
          >
            <div className="relative h-full min-h-0 overflow-hidden">
              <MainTerminalStack
                tabs={tabs}
                activeTabId={activeTabId}
                workspaceActive={workspaceActive}
                emptyLabel={t("terminal.noSession")}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle
            withHandle
            disabled={bottomPanelCollapsed}
            className={
              bottomPanelCollapsed
                ? "pointer-events-none h-0 min-h-0 overflow-hidden opacity-0"
                : undefined
            }
          />
          <ResizablePanel
            id="agent-term"
            defaultSize={String(
              bottomPanelCollapsed ? COLLAPSED_AGENT_PCT : bottomPanelSize,
            )}
            minSize={bottomPanelCollapsed ? String(COLLAPSED_AGENT_PCT) : "15"}
            maxSize={bottomPanelCollapsed ? String(COLLAPSED_AGENT_PCT) : "55"}
            className="min-h-0 overflow-hidden"
            onResize={(size) => {
              if (!bottomPanelCollapsed) {
                bottomPct.current = Math.round(size.asPercentage);
              }
            }}
          >
            <AgentTerminalPanel
              workspaceActive={workspaceActive}
              collapsed={bottomPanelCollapsed}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      {/* 右栏：离页仍保持挂载（整页已 hidden），避免 AI 会话状态丢失 */}
      {!rightCollapsed && (
        <>
          <ResizableHandle />
          <ResizablePanel
            id="right"
            defaultSize={rightWidth}
            minSize={240}
            maxSize={520}
            className="overflow-hidden bg-sidebar"
            onResize={(size) => {
              rightPx.current = size.inPixels;
            }}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  …
                </div>
              }
            >
              <TerminalRightPanel />
            </Suspense>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
