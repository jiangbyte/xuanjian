/**
 * @file 应用外壳布局
 * @author Charlie
 * @description 标题栏 + 侧栏 + 主内容区；终端工作区常驻挂载以保留滚动缓冲。
 * 启动时初始化会话录制与传输进度监听，并绑定 Ctrl/Cmd+J 打开快速切换。
 * 设置/快速切换按需懒加载；离终端页时卸载左右侧栏以停止轮询与重型编辑器。
 */

import { lazy, memo, Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { TerminalWorkspace } from "@/features/terminal/TerminalWorkspace";
import { getSetting } from "@/lib/db/settings";
import { hydrateHostOs } from "@/lib/platform";
import { initSessionRecorder } from "@/lib/sessionRecorder";
import { api } from "@/lib/tauri";
import { type ThemeMode, useSettingsStore } from "@/stores/settings";
import { initTransferProgressListener } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

const QuickSwitcher = lazy(() =>
  import("@/features/terminal/QuickSwitcher").then((m) => ({
    default: m.QuickSwitcher,
  })),
);

/** 快速切换独立订阅，避免打开弹层时重渲染整棵外壳 */
function ShellOverlays() {
  const switcherOpen = useUiStore((s) => s.switcherOpen);
  return (
    <>
      {switcherOpen ? (
        <Suspense fallback={null}>
          <QuickSwitcher />
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
  const { pathname } = useLocation();
  const onTerminal = pathname === "/terminal";
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);

  useEffect(() => {
    const stop = initSessionRecorder();
    return () => stop();
  }, []);

  useEffect(() => initTransferProgressListener(), []);

  useEffect(() => {
    api
      .hostPlatform()
      .then(hydrateHostOs)
      .catch(() => undefined);
  }, []);

  /** 启动时从 DB 同步主题（默认明亮） */
  useEffect(() => {
    getSetting("theme")
      .then((v) => {
        const theme = (v as ThemeMode | null) || "light";
        useSettingsStore.getState().hydrate({ theme });
      })
      .catch(console.error);
  }, []);

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
