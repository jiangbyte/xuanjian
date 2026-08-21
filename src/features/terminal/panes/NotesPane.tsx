import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "../../../lib/db";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { Select } from "../../../components/Select";
import { useDialog } from "../../../components/Dialog";
import {
  openContextMenu,
  useContextMenu,
} from "../../../components/ContextMenu";

export function NotesPane() {
  const { t } = useTranslation();
  const dialog = useDialog();
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
    const [cats, rows] = await Promise.all([
      listNoteCategories(),
      listNotes(),
    ]);
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

  const categoryOptions = useMemo(
    () => [
      { value: "all", label: t("notes.allCategories") },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
      { value: "none", label: t("notes.uncategorized") },
    ],
    [categories, t],
  );

  const editCategoryOptions = useMemo(
    () => [
      { value: "", label: t("notes.uncategorized") },
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

  const save = async () => {
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
                : categories.find((c) => c.id === noteCategoryId)?.name ?? null,
          }
        : null,
    );
  };

  useEffect(() => {
    if (!dirty || !editing) return;
    const timer = window.setTimeout(() => {
      save().catch(console.error);
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, noteCategoryId, dirty, editing?.id]);

  if (editing) {
    return (
      <div className="panel flex h-full flex-col">
        <div className="panel-header flex items-center gap-2">
          <button
            className="icon-btn icon-btn-sm tip"
            data-tip={t("notes.back")}
            onClick={async () => {
              if (dirty) await save();
              setEditing(null);
              await reload();
            }}
          >
            <ArrowLeft size={13} />
          </button>
          <input
            className="field field-sm flex-1 border-none bg-transparent px-0 shadow-none"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
          <button
            className="icon-btn icon-btn-sm tip"
            data-tip={t("notes.delete")}
            onClick={async () => {
              if (
                !(await dialog.confirm(t("notes.deleteConfirm"), { danger: true }))
              )
                return;
              await deleteNote(editing.id);
              setEditing(null);
              await reload();
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <div className="border-b border-[var(--border)] px-2 py-1.5">
          <Select
            className="w-full"
            aria-label={t("notes.category")}
            value={noteCategoryId == null ? "" : String(noteCategoryId)}
            options={editCategoryOptions}
            onChange={(v) => {
              setNoteCategoryId(v === "" ? null : Number(v));
              setDirty(true);
            }}
          />
        </div>
        <div className="min-h-0 flex-1 p-1.5">
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
    <div className="panel flex h-full flex-col">
      <div className="panel-header flex items-center gap-2">
        <span className="text-xs font-medium">{t("notes.title")}</span>
        <button
          className="btn btn-sm ml-auto"
          onClick={() => navigate("/notes")}
        >
          {t("notes.manage")}
        </button>
      </div>
      <div className="border-b border-[var(--border)] px-2 py-2">
        <div className="field-icon-wrap">
          <Search size={13} className="field-icon" />
          <input
            className="field field-sm"
            placeholder={t("notes.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="mt-2">
          <Select
            className="w-full"
            aria-label={t("notes.category")}
            value={
              categoryId == null
                ? "all"
                : categoryId === -1
                  ? "none"
                  : String(categoryId)
            }
            options={categoryOptions}
            onChange={(v) => {
              if (v === "all") setCategoryId(null);
              else if (v === "none") setCategoryId(-1);
              else setCategoryId(Number(v));
            }}
          />
        </div>
        <button
          className="btn btn-sm btn-primary mt-2 w-full"
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
        </button>
      </div>
      <div className="panel-body panel-list min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div
            className="px-2 py-6 text-center text-xs muted"
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
          </div>
        ) : (
          filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              className="list-row list-row-stack"
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
                        !(await dialog.confirm(t("notes.deleteConfirm"), {
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
              <span className="list-row-title flex items-center gap-1 truncate">
                {!!n.pinned && <Pin size={12} />}
                <span className="truncate">{n.title}</span>
              </span>
              <span className="list-row-sub truncate">
                {n.category_name || t("notes.uncategorized")}
                {" · "}
                {n.body.replace(/[#>*_`\n]/g, " ").trim().slice(0, 40) ||
                  t("notes.emptyBody")}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
