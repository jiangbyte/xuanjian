/**
 * @file 设置页共用表单项：标签 → 说明 → 控件（纵向）
 * @author Charlie
 */

import type { ReactNode } from "react";

/** 设置字段：标题、可选 hint、下方控件 */
export function SettingField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 py-2.5">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
      <div className="pt-0.5">{children}</div>
    </div>
  );
}
