import { Outlet, useLocation } from "react-router-dom";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { QuickSwitcher } from "../features/terminal/QuickSwitcher";
import { SettingsModal } from "../features/settings/SettingsModal";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";
import { useEffect } from "react";
import { useUiStore } from "../stores/ui";
import { initSessionRecorder } from "../lib/sessionRecorder";
import { initTransferProgressListener } from "../stores/transfer";

export function AppShell() {
  const { pathname } = useLocation();
  const onTerminal = pathname === "/terminal";
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);

  useEffect(() => {
    const stop = initSessionRecorder();
    return () => stop();
  }, []);

  useEffect(() => initTransferProgressListener(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSwitcherOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {!onTerminal && <Sidebar />}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--bg)]">
          <div
            className="h-full"
            style={{ display: onTerminal ? "none" : "block" }}
          >
            <Outlet />
          </div>
          {/* Keep terminal mounted so xterm scrollback survives leaving /terminal. */}
          <div
            className="h-full"
            style={
              onTerminal
                ? undefined
                : {
                    position: "absolute",
                    inset: 0,
                    visibility: "hidden",
                    pointerEvents: "none",
                    zIndex: -1,
                  }
            }
            aria-hidden={!onTerminal}
          >
            <TerminalWorkspace />
          </div>
        </main>
      </div>
      <QuickSwitcher />
      <SettingsModal />
    </div>
  );
}
