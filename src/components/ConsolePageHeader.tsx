/**
 * @file 功能页顶栏（自动化 / 机群 / 审计等）
 * @author Charlie
 * @description 与主机、脚本页一致的直方顶栏，无大圆角卡片。
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  toolbar?: ReactNode;
  className?: string;
};

/** 功能页标题区（border-b + 行内图标） */
export function ConsolePageHeader({
  icon: Icon,
  title,
  description,
  children,
  toolbar,
  className,
}: Props) {
  return (
    <div className={cn("shrink-0 border-b border-border", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {toolbar ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {toolbar}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="border-t border-border px-5 py-3">{children}</div>
      ) : null}
    </div>
  );
}

/** 功能页内分区（直边框，与主机列表区一致） */
export function ConsoleSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col border border-border bg-background",
        className,
      )}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}

/** 空状态占位 */
export function ConsoleEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border px-6 py-12 text-center">
      <Icon
        size={20}
        strokeWidth={1.75}
        className="mb-3 text-muted-foreground"
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
