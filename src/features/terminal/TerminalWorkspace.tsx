/**
 * @file 终端三栏工作区
 * @author Charlie
 * @description 布局：左侧工具栏 | 中央 xterm | 右侧 AI；用 shadcn Resizable 调宽。
 * 拖拽中只写 ref / body class，松手再 persist，避免 Zustand 重渲染打断拖动手势。
 */

import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { XtermView } from "@/features/terminal/XtermView";
import { handleSessionClosed } from "@/lib/sessionConnect";
import { onSessionClosed } from "@/lib/tauri";
import { useUiStore } from "@/stores/ui";

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
  const setLeftWidth = useUiStore((s) => s.setLeftWidth);
  const setRightWidth = useUiStore((s) => s.setRightWidth);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const leftPx = useRef(leftWidth);
  const rightPx = useRef(rightWidth);
  const dragging = useRef(false);

  useEffect(() => {
    leftPx.current = leftWidth;
  }, [leftWidth]);
  useEffect(() => {
    rightPx.current = rightWidth;
  }, [rightWidth]);

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
    };
  }, []);

  const beginDrag = () => {
    if (dragging.current) return;
    dragging.current = true;
    document.body.classList.add("is-pane-resizing");
  };

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.classList.remove("is-pane-resizing");
  };

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full min-w-0"
      onLayoutChange={beginDrag}
      onLayoutChanged={(_layout, meta) => {
        endDrag();
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
        className="min-w-0 overflow-hidden bg-background"
      >
        <div className="relative h-full min-h-0 overflow-hidden">
          {tabs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("terminal.noSession")}
            </div>
          ) : (
            tabs.map((tab) => (
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
            ))
          )}
        </div>
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
