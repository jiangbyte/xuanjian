/**
 * @file 笔记控制台
 * @author Charlie
 * @description 笔记列表 + Markdown 编辑区；分类用头部下拉筛选，管理入口也在头部。
 */

import {
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import {
  SectionAsideHeader,
  sectionAsideClass,
  sectionAsideIconBtnClass,
  sectionAsideListClass,
} from "@/components/SectionSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { BatchActionBar } from "@/features/share/BatchActionBar";
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
import { dialogs } from "@/lib/dialogs";
import {
  selectionCheckboxClass,
  selectionNavClass,
  selectionRow,
} from "@/lib/selection";
import { exportToFile, formatImportToast, importFromFile } from "@/lib/share";
import { cn } from "@/lib/utils";

const NONE = "none";
const FILTER_ALL = "all";
const FILTER_NONE = "none";

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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  /** 默认预览；点编辑才进入编辑态 */
  const [isEditing, setIsEditing] = useState(false);

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
      setIsEditing(false);
      return;
    }
    if (syncedNoteIdRef.current === active.id) return;
    syncedNoteIdRef.current = active.id;
    setTitle(active.title);
    setBody(active.body);
    setPinned(!!active.pinned);
    setNoteCategoryId(active.category_id);
    setDirty(false);
    // 切换笔记默认预览；空文进入编辑
    setIsEditing(!active.body.trim());
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
    if (!dirty || !active || !isEditing) return;
    const timer = window.setTimeout(() => {
      save().catch(console.error);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [title, body, pinned, noteCategoryId, dirty, active, isEditing, save]);

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
      setIsEditing(true);
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const exitEdit = async () => {
    if (dirty) await save();
    setIsEditing(false);
  };

  /** 预览态直接置顶 / 取消，无需进入编辑 */
  const togglePin = async () => {
    if (!active) return;
    const next = !pinned;
    try {
      await updateNote(active.id, {
        title,
        body,
        pinned: next,
        category_id: noteCategoryId,
      });
      setPinned(next);
      await reload();
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

  const filterValue =
    categoryId == null
      ? FILTER_ALL
      : categoryId === -1
        ? FILTER_NONE
        : String(categoryId);

  const selectedCategory =
    categoryId != null && categoryId !== -1
      ? (categories.find((c) => c.id === categoryId) ?? null)
      : null;

  const createCategory = async () => {
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
  };

  const renameSelectedCategory = async () => {
    if (!selectedCategory) return;
    const name = await dialogs.prompt(t("notes.categoryNamePrompt"), {
      title: t("notes.renameCategory"),
      defaultValue: selectedCategory.name,
    });
    if (!name?.trim()) return;
    await renameNoteCategory(selectedCategory.id, name);
    await reload();
  };

  const deleteSelectedCategory = async () => {
    if (!selectedCategory) return;
    if (
      !(await dialogs.confirm(t("notes.deleteCategoryConfirm"), {
        danger: true,
      }))
    )
      return;
    await deleteNoteCategory(selectedCategory.id);
    setCategoryId(null);
    await reload();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-nowrap items-center gap-2">
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

          <Select
            value={filterValue}
            onValueChange={(v) => {
              if (v === FILTER_ALL) setCategoryId(null);
              else if (v === FILTER_NONE) setCategoryId(-1);
              else setCategoryId(Number(v));
            }}
          >
            <SelectTrigger
              className="h-9 w-[160px] shrink-0"
              aria-label={t("notes.category")}
            >
              <SelectValue placeholder={t("notes.categories")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>
                {t("notes.allCategories")} ({notes.length})
              </SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} ({categoryCounts.get(c.id) || 0})
                </SelectItem>
              ))}
              <SelectItem value={FILTER_NONE}>
                {t("notes.uncategorized")} ({categoryCounts.get("none") || 0})
              </SelectItem>
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-9 shrink-0"
                aria-label={t("notes.newCategory")}
                onClick={() => void createCategory()}
              >
                <Plus size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("notes.newCategory")}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-9 shrink-0"
                    disabled={!selectedCategory}
                    aria-label={t("notes.manage")}
                  >
                    <MoreHorizontal size={14} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("notes.manage")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void renameSelectedCategory()}>
                {t("notes.renameCategory")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void deleteSelectedCategory()}
              >
                {t("notes.deleteCategory")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className={cn(sectionAsideClass, "w-64")}>
          <SectionAsideHeader title={t("notes.title")}>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={sectionAsideIconBtnClass}
              title={t("share.import")}
              aria-label={t("share.import")}
              onClick={() => {
                importFromFile()
                  .then(async (r) => {
                    if (!r) return;
                    await reload();
                    toast.success(
                      `${t("share.importDone")} (${formatImportToast(r)})`,
                    );
                  })
                  .catch((e) => toast.error(String(e)));
              }}
            >
              <Upload size={14} />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={sectionAsideIconBtnClass}
              title={t("notes.new")}
              aria-label={t("notes.new")}
              onClick={() => create()}
            >
              <Plus size={14} />
            </Button>
          </SectionAsideHeader>
          <BatchActionBar
            className="gap-1.5 px-2"
            selectedCount={selectedIds.size}
            totalCount={filtered.length}
            onSelectAll={() =>
              setSelectedIds(new Set(filtered.map((n) => n.id)))
            }
            onClear={() => setSelectedIds(new Set())}
            onExport={() => {
              const ids = [...selectedIds];
              if (!ids.length) {
                toast.error(t("batch.needSelect"));
                return;
              }
              exportToFile(
                {
                  sections: {
                    hosts: false,
                    scripts: false,
                    notes: true,
                    dockerProjects: false,
                  },
                  noteIds: ids,
                },
                "xuanjian-notes.json",
              )
                .then((ok) => {
                  if (ok) toast.success(t("share.exportDone"));
                })
                .catch((e) => toast.error(String(e)));
            }}
            onDelete={() => {
              const ids = [...selectedIds];
              if (!ids.length) return;
              void (async () => {
                if (
                  !(await dialogs.confirm(
                    t("batch.deleteConfirm", { count: ids.length }),
                    { danger: true },
                  ))
                )
                  return;
                for (const id of ids) await deleteNote(id);
                setSelectedIds(new Set());
                const rows = await reload();
                if (activeId != null && ids.includes(activeId)) {
                  setActiveId(rows[0]?.id ?? null);
                }
              })();
            }}
          />
          <div className={sectionAsideListClass}>
            {filtered.length === 0 ? (
              <span
                className="px-2 py-4 text-center text-sm text-muted-foreground"
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
              filtered.map((n) => {
                const selected = selectedIds.has(n.id);
                const active = activeId === n.id;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                      !selected &&
                        (active
                          ? selectionNavClass
                          : "text-sidebar-foreground hover:bg-sidebar-accent"),
                      selectionRow(selected),
                    )}
                  >
                    <Checkbox
                      className={cn("mt-1", selected && selectionCheckboxClass)}
                      checked={selected}
                      onCheckedChange={(v) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (v === true) next.add(n.id);
                          else next.delete(n.id);
                          return next;
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
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
                                !(await dialogs.confirm(
                                  t("notes.deleteConfirm"),
                                  {
                                    danger: true,
                                    title: t("notes.delete"),
                                  },
                                ))
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
                  </div>
                );
              })
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
              <div className="shrink-0 border-b border-border">
                <div className="flex flex-nowrap items-center gap-0.5 px-3 py-2">
                  {isEditing ? (
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
                        className="mr-auto h-8 w-36"
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
                  ) : (
                    <div className="mr-auto flex min-w-0 items-center gap-2">
                      <Badge variant="secondary" className="shrink-0">
                        {noteCategoryId == null
                          ? t("notes.uncategorized")
                          : (categories.find((c) => c.id === noteCategoryId)
                              ?.name ?? t("notes.uncategorized"))}
                      </Badge>
                    </div>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant={pinned ? "default" : "ghost"}
                        aria-label={pinned ? t("notes.unpin") : t("notes.pin")}
                        onClick={() => {
                          if (isEditing) {
                            setPinned((v) => !v);
                            setDirty(true);
                          } else {
                            void togglePin();
                          }
                        }}
                      >
                        <Pin size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {pinned ? t("notes.unpin") : t("notes.pin")}
                    </TooltipContent>
                  </Tooltip>
                  {isEditing ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("notes.done")}
                          onClick={() => exitEdit()}
                        >
                          <Check size={14} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("notes.done")}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("notes.edit")}
                          onClick={() => setIsEditing(true)}
                        >
                          <Pencil size={14} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("notes.edit")}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={t("notes.delete")}
                        onClick={() => remove()}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("notes.delete")}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="px-4 pb-3">
                  {isEditing ? (
                    <Input
                      className="border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                      value={title}
                      onChange={(e) => {
                        setTitle(e.currentTarget.value);
                        setDirty(true);
                      }}
                    />
                  ) : (
                    <h2 className="truncate text-lg font-semibold">
                      {title || t("notes.untitled")}
                    </h2>
                  )}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                {isEditing ? (
                  <div className="flex min-h-0 flex-1 flex-col p-2">
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
                ) : (
                  <MarkdownViewer
                    source={body}
                    emptyHint={t("notes.previewEmpty")}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
