/**
 * @file 移动端底栏导航壳
 * @description APK 风格：主机 / 终端 / 文件 / 笔记 / 更多。无 AI、无桌面侧栏。
 */

import {
  FolderOpen,
  MoreHorizontal,
  NotebookPen,
  Server,
  Terminal,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/m", end: true, icon: Server, label: "主机" },
  { to: "/m/terminal", end: false, icon: Terminal, label: "终端" },
  { to: "/m/files", end: false, icon: FolderOpen, label: "文件" },
  { to: "/m/notes", end: false, icon: NotebookPen, label: "笔记" },
  { to: "/m/more", end: false, icon: MoreHorizontal, label: "更多" },
] as const;

export function MobileShell() {
  const { pathname } = useLocation();
  const hideTabBar =
    pathname.startsWith("/m/files/edit") ||
    pathname.startsWith("/m/notes/");

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <main
        className={cn(
          "min-h-0 flex-1 overflow-hidden",
          !hideTabBar && "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <Outlet />
      </main>
      {!hideTabBar ? (
        <nav
          className="flex shrink-0 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)]"
          aria-label="移动端主导航"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground",
                  )
                }
              >
                <Icon size={20} strokeWidth={1.75} />
                <span>{tab.label}</span>
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
