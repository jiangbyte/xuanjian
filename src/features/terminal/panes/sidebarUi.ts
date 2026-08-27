/**
 * @file 终端侧栏 UI 规范
 *
 * 字体层级（避免 text-[10px] / text-[11px]）：
 * - heading  12px  面板标题、分组标题
 * - title    14px  列表主标题
 * - meta     12px  副文本、元信息、标签内文
 * - mono     12px  等宽命令预览
 */

/** 侧栏列表内图标尺寸（配合 icon-xs 按钮） */
export const SIDEBAR_ICON = 12;

/** 面板标题栏 */
export const sidebarPanelTitleClass = "text-xs font-medium";

/** 面板标题栏计数等辅助信息 */
export const sidebarPanelMetaClass = "text-xs text-muted-foreground";

/** 分组折叠标题 */
export const sidebarGroupTitleClass =
  "min-w-0 flex-1 truncate text-left text-xs font-medium";

/** 多行列表项 */
export const sidebarItemRowClass =
  "flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent";

/** 单行列表项（历史命令等） */
export const sidebarListRowClass =
  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent";

/** 列表主标题 */
export const sidebarItemTitleClass =
  "text-sm font-medium leading-snug truncate";

/** 列表副文本 */
export const sidebarItemSubClass =
  "text-xs leading-snug text-muted-foreground truncate";

/** 标签行 */
export const sidebarTagRowClass = "mt-1 flex flex-wrap gap-1";

/** 等宽命令单行 */
export const sidebarMonoTitleClass =
  "min-w-0 flex-1 truncate text-left font-mono text-xs font-medium leading-snug";
