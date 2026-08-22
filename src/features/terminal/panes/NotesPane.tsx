/**
 * @file 终端侧栏笔记面板
 * @author Charlie
 * @description 按分类分组（可展开收起，同脚本包）；默认预览，点编辑才写。
 */

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { Badge } from "@/components/ui/badge";
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
import {
  createNote,
  deleteNote,
  listNoteCategories,
  listNotes,
  NoteCategoryRow,
  NoteRow,
  updateNote,
} from "@/lib/db";
import { dialogs } from "@/lib/ui/dialogs";
import { cn } from "@/lib/utils";

const listRowClass =
  "flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent";

type CategoryGroup = {
  id: number | "none";
  name: string;
  notes: NoteRow[];
};

/**
 * 笔记侧栏：分组列表 → 预览 → 编辑。
 */
export function NotesPane() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<NoteCategoryRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [noteCategoryId, setNoteCategoryId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const reload = useCallback(async () => {
    const [cats, rows] = await Promise.all([listNoteCategories(), listNotes()]);
    setCategories(cats);
    setNotes(rows);
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(query) ||
        n.body.toLowerCase().includes(query) ||
        (n.category_name || "").toLowerCase().includes(query),
    );
  }, [notes, q]);

  const groups = useMemo((): CategoryGroup[] => {
    const map = new Map<number | "none", NoteRow[]>();
    for (const c of categories) map.set(c.id, []);
    map.set("none", []);
    for (const n of filtered) {
      const key = n.category_id == null ? "none" : n.category_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }

    const result: CategoryGroup[] = [];
    for (const c of categories) {
      const items = map.get(c.id) || [];
      if (items.length === 0) continue;
      result.push({ id: c.id, name: c.name, notes: items });
    }
    const uncategorized = map.get("none") || [];
    if (uncategorized.length > 0) {
      result.push({
        id: "none",
        name: t("notes.uncategorized"),
        notes: uncategorized,
      });
    }
    return result;
  }, [categories, filtered, t]);

  const isCollapsed = (id: number | "none") => {
    if (q.trim()) return false;
    return !!collapsed[String(id)];
  };

  const toggle = (id: number | "none") => {
    const key = String(id);
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const editCategoryOptions = useMemo(
    () => [
      { value: "none", label: t("notes.uncategorized") },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [categories, t],
  );

  const openNote = (n: NoteRow, startEditing = false) => {
    setEditing(n);
    setTitle(n.title);
    setBody(n.body);
    setNoteCategoryId(n.category_id);
    setDirty(false);
    setIsEditing(startEditing || !n.body.trim());
  };

  const createNew = async (categoryId: number | null = null) => {
    const id = await createNote({
      title: t("notes.untitled"),
      body: "",
      category_id: categoryId,
    });
    await reload();
    const row = (await listNotes()).find((n) => n.id === id);
    if (row) openNote(row, true);
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
    if (!dirty || !editing || !isEditing) return;
    const timer = window.setTimeout(() => {
      save().catch(console.error);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [title, body, noteCategoryId, dirty, editing, isEditing, save]);

  const exitEdit = async () => {
    if (dirty) await save();
    setIsEditing(false);
  };

  const togglePin = async () => {
    if (!editing) return;
    const next = !editing.pinned;
    await updateNote(editing.id, {
      title,
      body,
      pinned: next,
      category_id: noteCategoryId,
    });
    setEditing((prev) => (prev ? { ...prev, pinned: next ? 1 : 0 } : null));
    await reload();
  };

  const noteContextItems = (n: NoteRow) => [
    {
      id: "open",
      label: t("context.open"),
      onClick: () => openNote(n),
    },
    {
      id: "edit",
      label: t("notes.edit"),
      onClick: () => openNote(n, true),
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
    "sep" as const,
    {
      id: "delete",
      label: t("notes.delete"),
      danger: true as const,
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
  ];

  if (editing) {
    const categoryLabel =
      noteCategoryId == null
        ? t("notes.uncategorized")
        : (categories.find((c) => c.id === noteCategoryId)?.name ??
          t("notes.uncategorized"));

    return (
      <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
        {/* 工具行：仅返回 / 编辑·完成 / 删除 */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
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
                  setIsEditing(false);
                  await reload();
                }}
              >
                <ArrowLeft size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("notes.back")}</TooltipContent>
          </Tooltip>
          <div className="ml-auto flex items-center gap-0.5">
            {!isEditing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant={editing.pinned ? "default" : "ghost"}
                    aria-label={
                      editing.pinned ? t("notes.unpin") : t("notes.pin")
                    }
                    onClick={() => togglePin()}
                  >
                    <Pin size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {editing.pinned ? t("notes.unpin") : t("notes.pin")}
                </TooltipContent>
              </Tooltip>
            )}
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
                    setIsEditing(false);
                    await reload();
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("notes.delete")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 标题与元信息：单独一行，不与工具按钮混排 */}
        <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
          {isEditing ? (
            <Input
              className="h-8 border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          ) : (
            <h2 className="truncate text-base font-semibold leading-snug">
              {title || t("notes.untitled")}
            </h2>
          )}
          {isEditing ? (
            <Select
              value={noteCategoryId == null ? "none" : String(noteCategoryId)}
              onValueChange={(v) => {
                setNoteCategoryId(v === "none" ? null : Number(v));
                setDirty(true);
              }}
            >
              <SelectTrigger
                className="w-full"
                size="sm"
                aria-label={t("notes.category")}
              >
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
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="max-w-full truncate">
                {categoryLabel}
              </Badge>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isEditing ? (
            <div className="flex min-h-0 flex-1 flex-col p-1.5">
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
            <MarkdownViewer source={body} emptyHint={t("notes.previewEmpty")} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("notes.title")}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label={t("notes.new")}
              onClick={() => createNew(null)}
            >
              <Plus size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("notes.new")}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => navigate("/notes")}
        >
          {t("notes.manage")}
        </Button>
      </div>

      <div className="border-b border-border px-2 py-2">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Search size={13} />
          </InputGroupAddon>
          <InputGroupInput
            className="text-sm"
            placeholder={t("notes.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {filtered.length === 0 ? (
          <p
            className="px-2 py-4 text-center text-sm text-muted-foreground"
            onContextMenu={(e) =>
              openContextMenu(e, openMenu, [
                {
                  id: "new",
                  label: t("notes.new"),
                  onClick: () => createNew(null),
                },
              ])
            }
          >
            {t("notes.empty")}
          </p>
        ) : (
          groups.map((group) => {
            const closed = isCollapsed(group.id);
            return (
              <div key={String(group.id)} className="mb-1">
                <button
                  type="button"
                  className={cn(listRowClass, "py-1.5")}
                  onClick={() => toggle(group.id)}
                  onContextMenu={(e) =>
                    openContextMenu(e, openMenu, [
                      {
                        id: "new",
                        label: t("notes.new"),
                        onClick: () =>
                          createNew(group.id === "none" ? null : group.id),
                      },
                    ])
                  }
                >
                  {closed ? (
                    <ChevronRight
                      size={13}
                      className="shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <ChevronDown
                      size={13}
                      className="shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                    {group.name}
                  </span>
                  <Badge variant="secondary">{group.notes.length}</Badge>
                </button>
                {!closed &&
                  group.notes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={cn(listRowClass, "pl-6")}
                      onClick={() => openNote(n)}
                      onContextMenu={(e) =>
                        openContextMenu(e, openMenu, noteContextItems(n))
                      }
                    >
                      <div className="min-w-0 w-full space-y-0.5 text-left">
                        <div className="flex items-center gap-1 truncate text-sm font-semibold">
                          {!!n.pinned && <Pin size={12} className="shrink-0" />}
                          <span className="truncate">{n.title}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {n.body
                            .replace(/[#>*_`\n]/g, " ")
                            .trim()
                            .slice(0, 40) || t("notes.emptyBody")}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
