/**
 * @file 笔记控制台
 * @author Charlie
 * @description 分类侧栏 + 笔记列表 + Markdown 编辑区，支持置顶、搜索与自动保存。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Pin, Plus, Search, Trash2 } from "lucide-react";
import {
  createNote,
  createNoteCategory,
  deleteNote,
  deleteNoteCategory,
  listNoteCategories,
  listNotes,
  NoteCategoryRow,
  NoteRow,
  renameNoteCategory,
  updateNote,
} from "@/lib/db";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Select } from "@/components/Select";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { useDialog } from "@/components/Dialog";

/** 笔记管理主界面 */
export function NotesConsole() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const dialog = useDialog();
  const [categories, setCategories] = useState<NoteCategoryRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [noteCategoryId, setNoteCategoryId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(async () => {
    const [cats, rows] = await Promise.all([listNoteCategories(), listNotes()]);
    setCategories(cats);
    setNotes(rows);
    return rows;
  }, []);

  useEffect(() => {
    reload()
      .then((rows) => {
        setActiveId((id) => (id == null && rows[0] ? rows[0].id : id));
      })
      .catch(console.error);
  }, [reload]);

  const active = useMemo(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId],
  );

  /** 已同步到编辑区的笔记 id；同 id 的列表刷新不覆盖未保存编辑 */
  const syncedNoteIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      syncedNoteIdRef.current = null;
      setTitle("");
      setBody("");
      setPinned(false);
      setNoteCategoryId(null);
      setDirty(false);
      return;
    }
    if (syncedNoteIdRef.current === active.id) return;
    syncedNoteIdRef.current = active.id;
    setTitle(active.title);
    setBody(active.body);
    setPinned(!!active.pinned);
    setNoteCategoryId(active.category_id);
    setDirty(false);
  }, [active]);

  const categoryCounts = useMemo(() => {
    const map = new Map<number | "none", number>();
    for (const c of categories) map.set(c.id, 0);
    map.set("none", 0);
    for (const n of notes) {
      if (n.category_id == null) map.set("none", (map.get("none") || 0) + 1);
      else map.set(n.category_id, (map.get(n.category_id) || 0) + 1);
    }
    return map;
  }, [categories, notes]);

  const filtered = useMemo(() => {
    let list = notes;
    if (categoryId === -1) list = list.filter((n) => n.category_id == null);
    else if (categoryId != null)
      list = list.filter((n) => n.category_id === categoryId);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        (n.category_name || "").toLowerCase().includes(q),
    );
  }, [notes, categoryId, search]);

  const save = useCallback(async () => {
    if (!active || saving) return;
    setSaving(true);
    try {
      await updateNote(active.id, {
        title,
        body,
        pinned,
        category_id: noteCategoryId,
      });
      setDirty(false);
      await reload();
    } catch (e) {
      await dialog.alert(String(e));
    } finally {
      setSaving(false);
    }
  }, [active, saving, title, body, pinned, noteCategoryId, reload, dialog]);

  useEffect(() => {
    if (!dirty || !active) return;
    const timer = window.setTimeout(() => {
      save().catch(console.error);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [title, body, pinned, noteCategoryId, dirty, active, save]);

  const create = async () => {
    try {
      const id = await createNote({
        title: t("notes.untitled"),
        body: "",
        category_id:
          categoryId != null && categoryId !== -1 ? categoryId : null,
      });
      await reload();
      setActiveId(id);
    } catch (e) {
      await dialog.alert(String(e));
    }
  };

  const remove = async () => {
    if (!active) return;
    if (
      !(await dialog.confirm(t("notes.deleteConfirm"), {
        danger: true,
        title: t("notes.delete"),
      }))
    ) {
      return;
    }
    await deleteNote(active.id);
    const rows = await reload();
    setActiveId(rows[0]?.id ?? null);
  };

  const categoryOptions = useMemo(
    () => [
      { value: "", label: t("notes.uncategorized") },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [categories, t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* —— 工具栏 —— */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="field-icon-wrap flex-1">
          <Search size={14} className="field-icon" />
          <input
            className="field"
            placeholder={t("notes.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => create()}>
          <Plus size={14} />
          {t("notes.new")}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const name = await dialog.prompt(t("notes.categoryNamePrompt"), {
              title: t("notes.newCategory"),
            });
            if (!name?.trim()) return;
            try {
              const id = await createNoteCategory(name);
              await reload();
              setCategoryId(id);
            } catch (e) {
              await dialog.alert(String(e));
            }
          }}
        >
          <FolderPlus size={14} />
          {t("notes.newCategory")}
        </button>
      </div>

      {/* —— 分类侧栏 + 列表 + 编辑区 —— */}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase tracking-wide muted">
              {t("notes.categories")}
            </span>
          </div>
          <div className="side-nav flex-1 overflow-y-auto px-2 pb-3">
            <button
              type="button"
              className={`list-row ${categoryId == null ? "is-active" : ""}`}
              onClick={() => setCategoryId(null)}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {t("notes.allCategories")}
              </span>
              <span className="count-badge">{notes.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`list-row ${categoryId === c.id ? "is-active" : ""}`}
                onClick={() => setCategoryId(c.id)}
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    {
                      id: "rename",
                      label: t("notes.renameCategory"),
                      onClick: async () => {
                        const name = await dialog.prompt(
                          t("notes.categoryNamePrompt"),
                          {
                            title: t("notes.renameCategory"),
                            defaultValue: c.name,
                          },
                        );
                        if (!name?.trim()) return;
                        await renameNoteCategory(c.id, name);
                        await reload();
                      },
                    },
                    {
                      id: "delete",
                      label: t("notes.deleteCategory"),
                      danger: true,
                      onClick: async () => {
                        if (
                          !(await dialog.confirm(
                            t("notes.deleteCategoryConfirm"),
                            { danger: true },
                          ))
                        )
                          return;
                        await deleteNoteCategory(c.id);
                        if (categoryId === c.id) setCategoryId(null);
                        await reload();
                      },
                    },
                  ])
                }
              >
                <span className="min-w-0 flex-1 truncate text-left text-sm">
                  {c.name}
                </span>
                <span className="count-badge">
                  {categoryCounts.get(c.id) || 0}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`list-row ${categoryId === -1 ? "is-active" : ""}`}
              onClick={() => setCategoryId(-1)}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {t("notes.uncategorized")}
              </span>
              <span className="count-badge">
                {categoryCounts.get("none") || 0}
              </span>
            </button>
          </div>
        </aside>

        <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase tracking-wide muted">
              {t("notes.title")}
            </span>
          </div>
          <div className="side-nav flex-1 overflow-y-auto px-2 pb-3">
            {filtered.length === 0 ? (
              <div
                className="px-2 py-6 text-center text-xs muted"
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    {
                      id: "new",
                      label: t("notes.new"),
                      onClick: () => {
                        create().catch(console.error);
                      },
                    },
                  ])
                }
              >
                {t("notes.empty")}
              </div>
            ) : (
              filtered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`list-row list-row-stack ${
                    activeId === n.id ? "is-active" : ""
                  }`}
                  onClick={() => setActiveId(n.id)}
                  onContextMenu={(e) =>
                    openContextMenu(e, openMenu, [
                      {
                        id: "open",
                        label: t("context.open"),
                        onClick: () => setActiveId(n.id),
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
                          if (activeId === n.id) {
                            setPinned(!n.pinned);
                            setDirty(true);
                          }
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
                            !(await dialog.confirm(t("notes.deleteConfirm"), {
                              danger: true,
                              title: t("notes.delete"),
                            }))
                          )
                            return;
                          await deleteNote(n.id);
                          const rows = await reload();
                          if (activeId === n.id) {
                            setActiveId(rows[0]?.id ?? null);
                          }
                        },
                      },
                    ])
                  }
                >
                  <span className="list-row-title flex w-full items-center gap-1 truncate">
                    {!!n.pinned && <Pin size={12} className="shrink-0" />}
                    <span className="truncate">{n.title}</span>
                  </span>
                  <span className="list-row-sub truncate">
                    {n.category_name || t("notes.uncategorized")}
                    {" · "}
                    {n.updated_at || n.created_at || ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!active ? (
            <div className="flex h-full items-center justify-center text-sm muted">
              {t("notes.pickOrCreate")}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
                <input
                  className="field flex-1 border-none bg-transparent px-0 text-base font-semibold shadow-none"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                />
                <Select
                  className="w-36"
                  aria-label={t("notes.category")}
                  value={noteCategoryId == null ? "" : String(noteCategoryId)}
                  options={categoryOptions}
                  onChange={(v) => {
                    setNoteCategoryId(v === "" ? null : Number(v));
                    setDirty(true);
                  }}
                />
                <button
                  className={`btn btn-sm tip ${pinned ? "btn-primary" : ""}`}
                  data-tip={t("notes.pin")}
                  onClick={() => {
                    setPinned((v) => !v);
                    setDirty(true);
                  }}
                >
                  <Pin size={13} />
                </button>
                <button
                  className="btn btn-sm"
                  disabled={saving || !dirty}
                  onClick={() => save()}
                >
                  {saving ? t("notes.saving") : t("notes.save")}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => remove()}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="min-h-0 flex-1 p-2">
                <MarkdownEditor
                  value={body}
                  onChange={(v) => {
                    setBody(v);
                    setDirty(true);
                  }}
                  height="100%"
                  preview="live"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
