/**
 * @file 主导航侧栏
 * @author Charlie
 * @description 品牌标识与主机 / 网络 / Docker / 脚本 / 笔记 / 日志等路由入口。
 */

import { NavLink as RouterNavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Container,
  Network,
  NotebookPen,
  ScrollText,
  Server,
  Zap,
} from "lucide-react";

const navLinkClass =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground";

/** 左侧导航：react-router NavLink + shadcn sidebar tokens */
export function Sidebar() {
  const { t } = useTranslation();

  const items = [
    { to: "/", end: true, icon: Server, label: t("nav.hosts") },
    { to: "/network", icon: Network, label: t("nav.network") },
    { to: "/docker", icon: Container, label: t("nav.docker") },
    { to: "/scripts", icon: Zap, label: t("nav.scripts") },
    { to: "/notes", icon: NotebookPen, label: t("nav.notes") },
    { to: "/logs", icon: ScrollText, label: t("nav.logs") },
  ] as const;

  return (
    <aside
      className="flex w-[208px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <img
          src="/app-icon.png?v=20260821"
          alt=""
          className="size-7 shrink-0"
          width={28}
          height={28}
        />
        <span className="text-sm font-semibold tracking-wide">{t("brand")}</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <RouterNavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : undefined}
              className={navLinkClass}
            >
              <Icon size={16} />
              {item.label}
            </RouterNavLink>
          );
        })}
      </nav>
    </aside>
  );
}
