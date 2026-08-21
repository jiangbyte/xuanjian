/**
 * @file 主导航侧栏
 * @author Charlie
 * @description 品牌标识与主机 / 网络 / 脚本 / 笔记 / 日志等路由入口。
 * 终端全屏模式下由 AppShell 隐藏本侧栏。
 */

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network, NotebookPen, ScrollText, Server, Zap } from "lucide-react";

/**
 * 左侧导航：使用 NavLink 高亮当前路由。
 */
export function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)]">
      {/* —— 品牌 —— */}
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="brand-mark">玄</div>
        <div className="text-sm font-semibold tracking-wide">{t("brand")}</div>
      </div>
      {/* —— 主导航 —— */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <Server size={16} />
          {t("nav.hosts")}
        </NavLink>
        <NavLink
          to="/network"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <Network size={16} />
          {t("nav.network")}
        </NavLink>
        <NavLink
          to="/scripts"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <Zap size={16} />
          {t("nav.scripts")}
        </NavLink>
        <NavLink
          to="/notes"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <NotebookPen size={16} />
          {t("nav.notes")}
        </NavLink>
        <NavLink
          to="/logs"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <ScrollText size={16} />
          {t("nav.logs")}
        </NavLink>
      </nav>
    </aside>
  );
}
