/**
 * @file 路径书签按钮
 * @author Charlie
 * @description 本地 / SSH 路径收藏入口：切换当前路径书签并列出同 scope 书签。
 * 菜单 Portal 定位；导航通过 onNavigate 回调，不直接改路由。
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bookmark, BookmarkCheck, Folder, Trash2, X } from "lucide-react";
import { bookmarkLabel, usePathBookmarks } from "@/stores/pathBookmarks";

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

/**
 * 路径书签按钮与下拉菜单。
 * @param scope 书签作用域（如 `local` / `ssh:1`）
 * @param path 当前路径；空则无法添加
 * @param onNavigate 选中书签后跳转路径
 * @副作用 读写 pathBookmarks store（localStorage）
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const byScope = usePathBookmarks((s) => s.byScope);
  const bookmarks = byScope[scope] ?? [];
  const has = usePathBookmarks((s) => s.has);
  const toggle = usePathBookmarks((s) => s.toggle);
  const remove = usePathBookmarks((s) => s.remove);
  const bookmarked = Boolean(path) && has(scope, path);

  const updatePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(
      280,
      Math.max(140, preferBelow ? spaceBelow : spaceAbove),
    );
    const width = 260;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setPos({
      top: preferBelow
        ? rect.bottom + 4
        : Math.max(8, rect.top - maxHeight - 4),
      left,
      width,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`icon-btn icon-btn-sm tip ${bookmarked || open ? "is-active" : ""}`}
        data-tip={t("terminal.bookmark")}
        aria-label={t("terminal.bookmark")}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {bookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="bookmark-menu"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            role="menu"
          >
            {/* —— 头部 —— */}
            <div className="bookmark-menu-head">
              <span>{t("terminal.bookmarks")}</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => setOpen(false)}
              >
                <X size={12} />
              </button>
            </div>
            {/* —— 书签列表 —— */}
            <div className="bookmark-menu-body">
              {bookmarks.length === 0 ? (
                <div className="bookmark-menu-empty">
                  {t("terminal.bookmarkEmpty")}
                </div>
              ) : (
                bookmarks.map((b) => (
                  <div key={b.path} className="bookmark-menu-row" role="none">
                    <button
                      type="button"
                      className="bookmark-menu-item"
                      role="menuitem"
                      onClick={() => {
                        onNavigate(b.path);
                        setOpen(false);
                      }}
                      title={b.path}
                    >
                      <Folder
                        size={13}
                        className="shrink-0 text-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[12px] font-medium">
                          {bookmarkLabel(b.path)}
                        </span>
                        <span className="block truncate text-[10px] muted">
                          {b.path}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm shrink-0 tip"
                      data-tip={t("terminal.bookmarkRemove")}
                      onClick={() => remove(scope, b.path)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
            {/* —— 添加 / 移除当前路径 —— */}
            <div className="bookmark-menu-foot">
              <button
                type="button"
                className="btn btn-sm w-full"
                disabled={!path}
                onClick={() => {
                  if (!path) return;
                  toggle(scope, path);
                }}
              >
                {bookmarked
                  ? t("terminal.bookmarkRemoveCurrent")
                  : t("terminal.bookmarkAddCurrent")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
