/**
 * @file 应用外壳布局
 * @author Charlie
 * @description 标题栏 + 侧栏 + 主内容区；终端工作区常驻挂载以保留滚动缓冲。
 * 启动时初始化会话录制与传输进度监听，并绑定 Ctrl/Cmd+J 打开快速切换。
 */

import { Outlet, useLocation } from "react-router-dom";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { QuickSwitcher } from "@/features/terminal/QuickSwitcher";
import { SettingsModal } from "@/features/settings/SettingsModal";
import { TerminalWorkspace } from "@/features/terminal/TerminalWorkspace";
import { useEffect } from "react";
import { useUiStore } from "@/stores/ui";
import { initSessionRecorder } from "@/lib/sessionRecorder";
import { initTransferProgressListener } from "@/stores/transfer";

/**
 * 顶层布局壳：非终端路由显示侧栏与 Outlet；终端区始终挂载，离页时隐藏。
 */
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
        <main className="relative min-w-0 flex-1 overflow-hidden bg-background">
          {/* —— 业务页面 Outlet（终端页时隐藏） —— */}
          <div
            className="h-full"
            style={{ display: onTerminal ? "none" : "block" }}
          >
            <Outlet />
          </div>
          {/* 保持终端挂载，离开 /terminal 时仍保留 xterm 滚动缓冲 */}
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
