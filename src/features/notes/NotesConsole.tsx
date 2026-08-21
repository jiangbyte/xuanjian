/**
 * @file 笔记控制台
 * @author Charlie
 * @description 分类侧栏 + 笔记列表 + Markdown 编辑区，支持置顶、搜索与自动保存。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { dialogs } from "@/lib/dialogs";
import { useTranslation } from "react-i18next";
import { FolderPlus, Loader2, Pin, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";

const NONE = "none";

/** 笔记管理主界面 */
export function NotesConsole() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
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
      await dialogs.alert(String(e));
    } finally {
      setSaving(false);
    }
  }, [active, saving, title, body, pinned, noteCategoryId, reload]);

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
      await dialogs.alert(String(e));
    }
  };

  const remove = async () => {
    if (!active) return;
    if (
      !(await dialogs.confirm(t("notes.deleteConfirm"), {
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
      { value: NONE, label: t("notes.uncategorized") },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [categories, t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-nowrap items-center gap-3">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
              <Search size={14} />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("notes.search")}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </InputGroup>
          <Button onClick={() => create()}>
            <Plus size={14} />
            {t("notes.new")}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const name = await dialogs.prompt(t("notes.categoryNamePrompt"), {
                title: t("notes.newCategory"),
              });
              if (!name?.trim()) return;
              try {
                const id = await createNoteCategory(name);
                await reload();
                setCategoryId(id);
              } catch (e) {
                await dialogs.alert(String(e));
              }
            }}
          >
            <FolderPlus size={14} />
            {t("notes.newCategory")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-background">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {t("notes.categories")}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
            <SidebarNavItem
              active={categoryId == null}
              label={t("notes.allCategories")}
              count={notes.length}
              onClick={() => setCategoryId(null)}
            />
            {categories.map((c) => (
              <SidebarNavItem
                key={c.id}
                active={categoryId === c.id}
                label={c.name}
                count={categoryCounts.get(c.id) || 0}
                onClick={() => setCategoryId(c.id)}
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    {
                      id: "rename",
                      label: t("notes.renameCategory"),
                      onClick: async () => {
                        const name = await dialogs.prompt(
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
                          !(await dialogs.confirm(
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
              />
            ))}
            <SidebarNavItem
              active={categoryId === -1}
              label={t("notes.uncategorized")}
              count={categoryCounts.get("none") || 0}
              onClick={() => setCategoryId(-1)}
            />
          </div>
        </aside>

        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-background">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {t("notes.title")}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
            {filtered.length === 0 ? (
              <span
                className="px-2 py-4 text-center text-xs text-muted-foreground"
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
              </span>
            ) : (
              filtered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={cn(
                    "flex w-full rounded-md p-2 text-left transition-colors hover:bg-muted",
                    activeId === n.id && "bg-muted",
                  )}
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
                            !(await dialogs.confirm(t("notes.deleteConfirm"), {
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
                  <div className="min-w-0 w-full space-y-0.5">
                    <p className="flex items-center gap-1 truncate text-sm font-semibold">
                      {!!n.pinned && <Pin size={12} className="shrink-0" />}
                      <span className="truncate">{n.title}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {n.category_name || t("notes.uncategorized")}
                      {" · "}
                      {n.updated_at || n.created_at || ""}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!active ? (
            <div className="flex h-full items-center justify-center">
              <span className="text-sm text-muted-foreground">
                {t("notes.pickOrCreate")}
              </span>
            </div>
          ) : (
            <>
              <div className="border-b border-border px-4 py-2">
                <div className="flex flex-nowrap items-center gap-2">
                  <Input
                    className="flex-1 border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.currentTarget.value);
                      setDirty(true);
                    }}
                  />
                  <Select
                    value={
                      noteCategoryId == null ? NONE : String(noteCategoryId)
                    }
                    onValueChange={(v) => {
                      setNoteCategoryId(v === NONE ? null : Number(v));
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger
                      className="w-36"
                      aria-label={t("notes.category")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant={pinned ? "default" : "outline"}
                    size="icon-sm"
                    title={t("notes.pin")}
                    onClick={() => {
                      setPinned((v) => !v);
                      setDirty(true);
                    }}
                  >
                    <Pin size={13} />
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={saving || !dirty}
                    onClick={() => save()}
                  >
                    {saving ? <Loader2 className="animate-spin" /> : null}
                    {saving ? t("notes.saving") : t("notes.save")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    onClick={() => remove()}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col p-2">
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

function SidebarNavItem({
  active,
  label,
  count,
  onClick,
  onContextMenu,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-muted",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="truncate">{label}</span>
      <Badge variant="secondary" className="shrink-0">
        {count}
      </Badge>
    </button>
  );
}
