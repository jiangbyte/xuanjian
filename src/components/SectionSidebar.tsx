/**
 * @file 分区侧栏共用样式（主机分组 / Docker / 脚本包 / 笔记分类）
 * @author Charlie
 */

import type { MouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { selectionNavClass } from "@/lib/core/selection";
import { cn } from "@/lib/utils";

export const sectionAsideClass =
  "flex w-48 shrink-0 flex-col border-r border-sidebar-border bg-sidebar";

export const sectionAsideHeaderClass =
  "flex items-center justify-between gap-1 border-b border-sidebar-border px-2 py-2";

export const sectionAsideTitleClass =
  "truncate px-1 text-sm font-semibold text-sidebar-foreground";

export const sectionAsideListClass =
  "flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2";

export const sectionAsideIconBtnClass = "size-7 shrink-0";

/** 侧栏顶栏：标题 + 右侧操作（通常为 +） */
export function SectionAsideHeader({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(sectionAsideHeaderClass, className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span className={sectionAsideTitleClass}>{title}</span>
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-0.5">{children}</div>
      ) : null}
    </div>
  );
}

/** 分组 / 分类导航项 */
export function SectionNavItem({
  active,
  label,
  count,
  onClick,
  onContextMenu,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
        active
          ? selectionNavClass
          : "text-sidebar-foreground hover:bg-sidebar-accent",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="truncate text-left">{label}</span>
      {count != null ? (
        <Badge
          variant="secondary"
          className={cn(
            "shrink-0",
            active && "border-transparent bg-background text-foreground",
          )}
        >
          {count}
        </Badge>
      ) : null}
    </button>
  );
}
