/**
 * @file 主导航侧栏 — GitHub Primer
 * @author Charlie
 * @description 品牌标识与主机 / 网络 / Docker / 脚本 / 笔记 / 日志等路由入口。
 */

import {
  Container,
  Network,
  NotebookPen,
  ScrollText,
  Server,
  Settings,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink as RouterNavLink } from "react-router-dom";

const navLinkClass =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground";

/** 左侧导航 */
export function Sidebar() {
  const { t } = useTranslation();

  const items = [
    { to: "/", end: true, icon: Server, label: t("nav.hosts") },
    { to: "/network", icon: Network, label: t("nav.network") },
    { to: "/docker", icon: Container, label: t("nav.docker") },
    { to: "/scripts", icon: Zap, label: t("nav.scripts") },
    { to: "/notes", icon: NotebookPen, label: t("nav.notes") },
    { to: "/logs", icon: ScrollText, label: t("nav.logs") },
    { to: "/settings", icon: Settings, label: t("nav.settings") },
  ] as const;

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5">
        <img
          src="/app-icon.png?v=20260821d"
          alt=""
          className="size-7 shrink-0"
          width={28}
          height={28}
        />
        <span className="text-base font-semibold tracking-tight">
          {t("brand")}
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <RouterNavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : undefined}
              className={navLinkClass}
            >
              <Icon size={18} className="opacity-70" />
              {item.label}
            </RouterNavLink>
          );
        })}
      </nav>
    </aside>
  );
}
