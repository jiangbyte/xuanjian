/**
 * @file 应用外壳布局
 * @author Charlie
 * @description 标题栏 + 侧栏 + 主内容区；终端工作区常驻挂载以保留滚动缓冲。
 * 启动时初始化会话录制与传输进度监听，并绑定 Ctrl/Cmd+J 打开快速切换。
 * 设置/快速切换按需懒加载；离终端页时卸载左右侧栏以停止轮询与重型编辑器。
 */

import { lazy, memo, Suspense, useEffect, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { TerminalWorkspace } from "@/features/terminal/TerminalWorkspace";
import { initSchedulerListener } from "@/lib/automation/schedulerListener";
import { runWhenIdle, showMainWindowWhenReady } from "@/lib/boot";
import { importCmdHistoryFromLocalStorage } from "@/lib/db/cmdHistory";
import { getSetting } from "@/lib/db/settings";
import { hydrateCmdHistory } from "@/stores/cmdHistory";
import { hydrateHostOs } from "@/lib/core/platform";
import { initSessionRecorder } from "@/lib/session/recorder";
import { api } from "@/lib/tauri";
import { type ThemeMode, useSettingsStore } from "@/stores/settings";
import { initTransferProgressListener } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

const QuickSwitcher = lazy(() =>
  import("@/features/terminal/QuickSwitcher").then((m) => ({
    default: m.QuickSwitcher,
  })),
);

const SettingsDialog = lazy(() =>
  import("@/features/settings/SettingsDialog").then((m) => ({
    default: m.SettingsDialog,
  })),
);

/** 快速切换、设置等全局浮层 */
function ShellOverlays() {
  const switcherOpen = useUiStore((s) => s.switcherOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  return (
    <>
      {switcherOpen ? (
        <Suspense fallback={null}>
          <QuickSwitcher />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      ) : null}
    </>
  );
}

const MemoTitleBar = memo(TitleBar);
const MemoSidebar = memo(Sidebar);

/**
 * 顶层布局壳：非终端路由显示侧栏与 Outlet；终端区始终挂载，离页时隐藏。
 */
export function AppShell() {
  const onTerminal = useLocation().pathname === "/terminal";
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  useLayoutEffect(() => {
    showMainWindowWhenReady();
  }, []);

  /** 首帧绘制后预加载 Monaco / xterm / 图表等重型模块 */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void import("@/lib/boot/preloadHeavyModules").then((m) =>
        m.preloadHeavyModules(),
      );
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const stop = initSessionRecorder();
    return () => stop();
  }, []);

  useEffect(() => {
    return runWhenIdle(() => {
      void import("@/lib/boot/seedSampleData")
        .then((m) => m.seedSampleDataIfNeeded())
        .catch(console.error);
    });
  }, []);

  useEffect(() => {
    return runWhenIdle(() => {
      void importCmdHistoryFromLocalStorage()
        .then(() => hydrateCmdHistory())
        .catch(console.error);
    });
  }, []);

  useEffect(() => initTransferProgressListener(), []);

  useEffect(() => {
    return runWhenIdle(() => initSchedulerListener());
  }, []);

  useEffect(() => {
    return runWhenIdle(() => {
      void api
        .hostPlatform()
        .then(hydrateHostOs)
        .catch(() => undefined);
    });
  }, []);

  /** 启动时从 DB 同步主题（默认跟随系统） */
  useEffect(() => {
    return runWhenIdle(() => {
      getSetting("theme")
        .then((v) => {
          const theme = (v as ThemeMode | null) || "system";
          useSettingsStore.getState().hydrate({ theme });
        })
        .catch(console.error);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, setSettingsOpen]);

  return (
    <div className="flex h-full flex-col">
      <MemoTitleBar />
      <div className="flex min-h-0 flex-1">
        <div
          className="contents"
          style={onTerminal ? { display: "none" } : undefined}
          aria-hidden={onTerminal}
        >
          <MemoSidebar />
        </div>
        <main className="relative min-w-0 flex-1 overflow-hidden bg-background">
          {/* —— 业务页面 Outlet（终端页时隐藏） —— */}
          <div
            className="h-full"
            style={{ display: onTerminal ? "none" : "block" }}
          >
            <Outlet />
          </div>
          {/* 保持终端挂载；离页时用 contain 降低 WebView 绘制开销 */}
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
                    contentVisibility: "hidden",
                    contain: "strict",
                  }
            }
            aria-hidden={!onTerminal}
          >
            <TerminalWorkspace workspaceActive={onTerminal} />
          </div>
        </main>
      </div>
      <ShellOverlays />
    </div>
  );
}
