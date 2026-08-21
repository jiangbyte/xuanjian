/**
 * @file 终端侧栏笔记面板
 * @author Charlie
 * @description 嵌入式笔记列表与 Markdown 编辑，数据来自本地 DB。
 * 编辑时自动防抖保存；可置顶、分类筛选、跳转完整笔记页。
 * 空列表与条目支持右键新建/删除等快捷操作。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { dialogs } from "@/lib/dialogs";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Pin, Plus, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  createNote,
  listNoteCategories,
  listNotes,
  deleteNote,
  NoteCategoryRow,
  NoteRow,
  updateNote,
} from "@/lib/db";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";

const listRowClass =
  "flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent";

/**
 * 笔记侧栏：列表模式与单篇编辑模式切换。
 */
export function NotesPane() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<NoteCategoryRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [noteCategoryId, setNoteCategoryId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(async () => {
    const [cats, rows] = await Promise.all([listNoteCategories(), listNotes()]);
    setCategories(cats);
    setNotes(rows);
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const filtered = useMemo(() => {
    let list = notes;
    if (categoryId === -1) list = list.filter((n) => n.category_id == null);
    else if (categoryId != null)
      list = list.filter((n) => n.category_id === categoryId);
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (n) =>
        n.title.toLowerCase().includes(query) ||
        n.body.toLowerCase().includes(query) ||
        (n.category_name || "").toLowerCase().includes(query),
    );
  }, [notes, categoryId, q]);

  const editCategoryOptions = useMemo(
    () => [
      { value: "none", label: t("notes.uncategorized") },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [categories, t],
  );

  const openNote = (n: NoteRow) => {
    setEditing(n);
    setTitle(n.title);
    setBody(n.body);
    setNoteCategoryId(n.category_id);
    setDirty(false);
  };

  const save = useCallback(async () => {
    if (!editing) return;
    await updateNote(editing.id, {
      title,
      body,
      pinned: !!editing.pinned,
      category_id: noteCategoryId,
    });
    setDirty(false);
    await reload();
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            title: title.trim() || t("notes.untitled"),
            body,
            category_id: noteCategoryId,
            category_name:
              noteCategoryId == null
                ? null
                : (categories.find((c) => c.id === noteCategoryId)?.name ??
                  null),
          }
        : null,
    );
  }, [editing, title, body, noteCategoryId, reload, t, categories]);

  useEffect(() => {
    if (!dirty || !editing) return;
    const timer = window.setTimeout(() => {
      save().catch(console.error);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [title, body, noteCategoryId, dirty, editing, save]);

  if (editing) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("notes.back")}
                onClick={async () => {
                  if (dirty) await save();
                  setEditing(null);
                  await reload();
                }}
              >
                <ArrowLeft size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("notes.back")}</TooltipContent>
          </Tooltip>
          <Input
            className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("notes.delete")}
                onClick={async () => {
                  if (
                    !(await dialogs.confirm(t("notes.deleteConfirm"), {
                      danger: true,
                    }))
                  )
                    return;
                  await deleteNote(editing.id);
                  setEditing(null);
                  await reload();
                }}
              >
                <Trash2 size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("notes.delete")}</TooltipContent>
          </Tooltip>
        </div>
        <div className="border-b border-border px-2 py-1.5">
          <Select
            value={noteCategoryId == null ? "none" : String(noteCategoryId)}
            onValueChange={(v) => {
              setNoteCategoryId(v === "none" ? null : Number(v));
              setDirty(true);
            }}
          >
            <SelectTrigger className="w-full" size="sm" aria-label={t("notes.category")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {editCategoryOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1.5">
          <MarkdownEditor
            value={body}
            onChange={(v) => {
              setBody(v);
              setDirty(true);
            }}
            height="100%"
            preview="edit"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium">{t("notes.title")}</span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="ml-auto"
          onClick={() => navigate("/notes")}
        >
          {t("notes.manage")}
        </Button>
      </div>

      <div className="border-b border-border px-2 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search size={13} />
          </InputGroupAddon>
          <InputGroupInput
            className="text-xs"
            placeholder={t("notes.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <div className="mt-2">
          <Select
            value={
              categoryId == null
                ? "all"
                : categoryId === -1
                  ? "none"
                  : String(categoryId)
            }
            onValueChange={(v) => {
              if (v === "all") setCategoryId(null);
              else if (v === "none") setCategoryId(-1);
              else setCategoryId(Number(v));
            }}
          >
            <SelectTrigger className="w-full" size="sm" aria-label={t("notes.category")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("notes.allCategories")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
              <SelectItem value="none">{t("notes.uncategorized")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="xs"
          className="mt-2 w-full"
          onClick={async () => {
            const id = await createNote({
              title: t("notes.untitled"),
              body: "",
              category_id:
                categoryId != null && categoryId !== -1 ? categoryId : null,
            });
            await reload();
            const row = (await listNotes()).find((n) => n.id === id);
            if (row) openNote(row);
          }}
        >
          <Plus size={13} />
          {t("notes.new")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {filtered.length === 0 ? (
          <p
            className="px-2 py-4 text-center text-xs text-muted-foreground"
            onContextMenu={(e) =>
              openContextMenu(e, openMenu, [
                {
                  id: "new",
                  label: t("notes.new"),
                  onClick: async () => {
                    const id = await createNote({
                      title: t("notes.untitled"),
                      body: "",
                      category_id:
                        categoryId != null && categoryId !== -1
                          ? categoryId
                          : null,
                    });
                    await reload();
                    const row = (await listNotes()).find((n) => n.id === id);
                    if (row) openNote(row);
                  },
                },
              ])
            }
          >
            {t("notes.empty")}
          </p>
        ) : (
          filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              className={listRowClass}
              onClick={() => openNote(n)}
              onContextMenu={(e) =>
                openContextMenu(e, openMenu, [
                  {
                    id: "open",
                    label: t("context.open"),
                    onClick: () => openNote(n),
                  },
                  {
                    id: "pin",
                    label: n.pinned ? t("notes.unpin") : t("notes.pin"),
                    onClick: async () => {
                      await updateNote(n.id, {
                        title: n.title,
                        body: n.body,
                        pinned: !n.pinned,
                        category_id: n.category_id,
                      });
                      await reload();
                    },
                  },
                  "sep",
                  {
                    id: "delete",
                    label: t("notes.delete"),
                    danger: true,
                    onClick: async () => {
                      if (
                        !(await dialogs.confirm(t("notes.deleteConfirm"), {
                          danger: true,
                          title: t("notes.delete"),
                        }))
                      )
                        return;
                      await deleteNote(n.id);
                      await reload();
                    },
                  },
                ])
              }
            >
              <div className="min-w-0 w-full space-y-0.5 text-left">
                <div className="flex items-center gap-1 truncate text-sm font-semibold">
                  {!!n.pinned && <Pin size={12} className="shrink-0" />}
                  <span className="truncate">{n.title}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {n.category_name || t("notes.uncategorized")}
                  {" · "}
                  {n.body
                    .replace(/[#>*_`\n]/g, " ")
                    .trim()
                    .slice(0, 40) || t("notes.emptyBody")}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
