/**
 * @file 终端三栏工作区
 * @author Charlie
 * @description 布局：左侧工具栏 | 中央 xterm | 右侧 AI；用 shadcn Resizable 调宽。
 * 拖拽中只写 ref / body class，松手再 persist，避免 Zustand 重渲染打断拖动手势。
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/ui";
import { XtermView } from "@/features/terminal/XtermView";
import { TerminalLeftPanel } from "@/features/terminal/TerminalLeftPanel";
import { TerminalRightPanel } from "@/features/terminal/TerminalRightPanel";
import { onSessionClosed } from "@/lib/tauri";
import { handleSessionClosed } from "@/lib/sessionConnect";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

/**
 * 终端主工作区：左栏 + 多标签 xterm + 右栏。
 */
export function TerminalWorkspace() {
  const { t } = useTranslation();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const leftCollapsed = useUiStore((s) => s.leftCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightCollapsed);
  const leftWidth = useUiStore((s) => s.leftWidth);
  const rightWidth = useUiStore((s) => s.rightWidth);
  const setLeftWidth = useUiStore((s) => s.setLeftWidth);
  const setRightWidth = useUiStore((s) => s.setRightWidth);
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;
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
      key={`term-${leftCollapsed ? 0 : 1}-${rightCollapsed ? 0 : 1}`}
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
      {!leftCollapsed && (
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
            <TerminalLeftPanel
              sessionId={active?.sessionId ?? null}
              kind={active?.kind ?? null}
              hostId={active?.hostId ?? null}
              shellId={active?.shellId ?? null}
            />
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
                <XtermView tab={tab} active={tab.id === activeTabId} />
              </div>
            ))
          )}
        </div>
      </ResizablePanel>

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
            <TerminalRightPanel />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
