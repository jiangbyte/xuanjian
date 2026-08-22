/**
 * @file 列表 / 导航选中态（GitHub Primer）
 * @author Charlie
 */

import { cn } from "@/lib/utils";

/** 导航选中：中性灰底 */
export const selectionNavClass = "bg-accent font-medium text-accent-foreground";

/** 卡片批量选中：灰底 + 主题色实线边 */
export const selectionCardClass = "border-primary bg-muted";

/** 列表批量勾选 */
export const selectionRowClass =
  "bg-muted text-foreground outline outline-1 outline-primary -outline-offset-1";

export const selectionActiveClass = selectionNavClass;

export const selectionCheckboxClass =
  "border-border data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground";

export function selectionNav(
  active: boolean,
  ...extra: Array<string | false | null | undefined>
) {
  return cn(active && selectionNavClass, ...extra);
}

export function selectionCard(
  selected: boolean,
  ...extra: Array<string | false | null | undefined>
) {
  return cn(selected && selectionCardClass, ...extra);
}

export function selectionRow(
  selected: boolean,
  ...extra: Array<string | false | null | undefined>
) {
  return cn(selected && selectionRowClass, ...extra);
}
