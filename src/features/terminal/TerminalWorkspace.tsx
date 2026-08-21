import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../../stores/ui";
import { XtermView } from "./XtermView";
import { TerminalLeftPanel } from "./TerminalLeftPanel";
import { TerminalRightPanel } from "./TerminalRightPanel";
import { onSessionClosed } from "../../lib/tauri";
import { handleSessionClosed } from "../../lib/sessionConnect";

type ResizeAxis = "left" | "right";

function ResizeHandle({ axis }: { axis: ResizeAxis }) {
  const drag = useRef<{
    startPos: number;
    startSize: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const { leftWidth, rightWidth } = useUiStore.getState();
    drag.current = {
      startPos: e.clientX,
      startSize: axis === "left" ? leftWidth : rightWidth,
    };
    document.body.classList.add("is-pane-resizing");

    const onMove = (ev: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      if (axis === "left") {
        const dx = ev.clientX - state.startPos;
        useUiStore.getState().setLeftWidth(state.startSize + dx, {
          persist: false,
        });
      } else {
        const dx = ev.clientX - state.startPos;
        useUiStore.getState().setRightWidth(state.startSize - dx, {
          persist: false,
        });
      }
    };

    const onUp = (ev: PointerEvent) => {
      drag.current = null;
      document.body.classList.remove("is-pane-resizing");
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      const { leftWidth, rightWidth, setLeftWidth, setRightWidth } =
        useUiStore.getState();
      setLeftWidth(leftWidth, { persist: true });
      setRightWidth(rightWidth, { persist: true });
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      className={`pane-resize-handle pane-resize-handle-${axis}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={axis === "left" ? "Resize left pane" : "Resize right pane"}
    />
  );
}

export function TerminalWorkspace() {
  const { t } = useTranslation();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const leftCollapsed = useUiStore((s) => s.leftCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightCollapsed);
  const leftWidth = useUiStore((s) => s.leftWidth);
  const rightWidth = useUiStore((s) => s.rightWidth);
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSessionClosed((p) => {
      handleSessionClosed(p.sessionId);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="terminal-split flex h-full min-w-0">
      {!leftCollapsed && (
        <div
          className="terminal-split-pane terminal-split-left flex h-full shrink-0 overflow-hidden"
          style={{ width: leftWidth }}
        >
          <TerminalLeftPanel
            sessionId={active?.sessionId ?? null}
            kind={active?.kind ?? null}
            hostId={active?.hostId ?? null}
            shellId={active?.shellId ?? null}
          />
          <ResizeHandle axis="left" />
        </div>
      )}

      <div className="terminal-split-center flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg)]">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {tabs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm muted">
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
      </div>

      {!rightCollapsed && (
        <div
          className="terminal-split-pane terminal-split-right flex h-full shrink-0 overflow-hidden"
          style={{ width: rightWidth }}
        >
          <ResizeHandle axis="right" />
          <TerminalRightPanel />
        </div>
      )}
    </div>
  );
}
