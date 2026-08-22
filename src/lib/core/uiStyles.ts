/**
 * @file 跨页面统一 class（GitHub Primer）
 * @author Charlie
 */

import { cn } from "@/lib/utils";

export const navItemClass =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors";

export const navItemIdleClass = "text-foreground hover:bg-muted";

export const navItemActiveClass =
  "bg-accent font-medium text-accent-foreground";

export const listRowClass =
  "mb-0.5 flex w-full flex-col rounded-md px-2.5 py-2 text-left text-sm transition-colors";

export const listRowIdleClass = "hover:bg-muted";

export const listRowActiveClass =
  "bg-accent font-medium text-accent-foreground";

export const segmentTabClass =
  "rounded-md px-3 py-1.5 text-sm transition-colors";

export const segmentTabIdleClass = "text-muted-foreground hover:bg-muted";

export const segmentTabActiveClass =
  "bg-accent font-medium text-accent-foreground";

export const formLabelClass = "text-sm font-medium text-foreground";

export const formSectionTitleClass = "text-sm font-semibold text-foreground";

export const pageTitleClass = "text-lg font-semibold tracking-tight";

export const hintClass = "text-sm text-muted-foreground";

export const emptyStateClass =
  "flex items-center justify-center rounded-md border border-dashed border-border p-12 text-sm text-muted-foreground";

export function navItem(
  active: boolean,
  ...extra: Array<string | false | null | undefined>
) {
  return cn(
    navItemClass,
    active ? navItemActiveClass : navItemIdleClass,
    ...extra,
  );
}

export function listRow(
  active: boolean,
  ...extra: Array<string | false | null | undefined>
) {
  return cn(
    listRowClass,
    active ? listRowActiveClass : listRowIdleClass,
    ...extra,
  );
}

export function segmentTab(
  active: boolean,
  ...extra: Array<string | false | null | undefined>
) {
  return cn(
    segmentTabClass,
    active ? segmentTabActiveClass : segmentTabIdleClass,
    ...extra,
  );
}
