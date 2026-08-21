/**
 * @file 路径书签按钮
 * @author Charlie
 * @description 本地 / SSH 路径收藏入口：切换当前路径书签并列出同 scope 书签。
 */

import { Bookmark, BookmarkCheck, Folder, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { bookmarkLabel, usePathBookmarks } from "@/stores/pathBookmarks";

/**
 * 路径书签按钮与下拉菜单。
 */
export function PathBookmarkButton({
  scope,
  path,
  onNavigate,
}: {
  scope: string;
  path: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const byScope = usePathBookmarks((s) => s.byScope);
  const bookmarks = byScope[scope] ?? [];
  const has = usePathBookmarks((s) => s.has);
  const toggle = usePathBookmarks((s) => s.toggle);
  const remove = usePathBookmarks((s) => s.remove);
  const bookmarked = Boolean(path) && has(scope, path);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={bookmarked ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={t("terminal.bookmark")}
            >
              {bookmarked ? (
                <BookmarkCheck size={14} />
              ) : (
                <Bookmark size={14} />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("terminal.bookmark")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="z-[100] w-[260px]">
        <DropdownMenuLabel>{t("terminal.bookmarks")}</DropdownMenuLabel>
        {bookmarks.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {t("terminal.bookmarkEmpty")}
          </p>
        ) : (
          <div className="max-h-[220px] space-y-0.5 overflow-auto">
            {bookmarks.map((b) => (
              <DropdownMenuItem
                key={b.path}
                className="group flex items-start gap-1"
                onSelect={() => onNavigate(b.path)}
              >
                <Folder size={13} className="mt-0.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {bookmarkLabel(b.path)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.path}
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded p-1 opacity-0 hover:bg-destructive/10 group-hover:opacity-100"
                  aria-label={t("terminal.bookmarkRemove")}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    remove(scope, b.path);
                  }}
                >
                  <Trash2 size={12} className="text-destructive" />
                </button>
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <div className="px-1 pb-1 pt-0.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="w-full"
            disabled={!path}
            onClick={() => {
              if (!path) return;
              toggle(scope, path);
            }}
          >
            {bookmarked
              ? t("terminal.bookmarkRemoveCurrent")
              : t("terminal.bookmarkAddCurrent")}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
