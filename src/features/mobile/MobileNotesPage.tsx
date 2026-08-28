/**
 * @file 移动端笔记列表与轻编辑
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileTopBar } from "@/features/mobile/MobileTopBar";
import {
  createNote,
  listNotes,
  updateNote,
  type NoteRow,
} from "@/lib/db";

export function MobileNotesPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const reload = useCallback(async () => {
    setNotes(await listNotes());
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const create = async () => {
    try {
      const id = await createNote({
        title: "新笔记",
        body: "",
        category_id: null,
      });
      await reload();
      navigate(`/m/notes/${id}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MobileTopBar
        title="笔记"
        right={
          <Button type="button" size="xs" onClick={() => void create()}>
            新建
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {notes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            暂无笔记
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-left"
                  onClick={() => navigate(`/m/notes/${n.id}`)}
                >
                  <div className="truncate text-sm font-medium">
                    {n.title || "无标题"}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {n.body || "…"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function MobileNoteEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const noteId = Number(id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(noteId)) {
      setLoading(false);
      return;
    }
    listNotes()
      .then((rows) => {
        const n = rows.find((x) => x.id === noteId);
        if (n) {
          setTitle(n.title);
          setBody(n.body);
        }
      })
      .finally(() => setLoading(false));
  }, [noteId]);

  const save = async () => {
    if (!Number.isFinite(noteId)) return;
    setSaving(true);
    try {
      await updateNote(noteId, { title, body });
      toast.success("已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MobileTopBar
        title="编辑笔记"
        onBack={() => navigate("/m/notes")}
        right={
          <Button
            type="button"
            size="xs"
            disabled={saving || loading}
            onClick={() => void save()}
          >
            {saving ? "…" : "保存"}
          </Button>
        }
      />
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : (
        <>
          <Input
            className="rounded-none border-0 border-b px-3 text-base shadow-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
          />
          <textarea
            className="min-h-0 flex-1 resize-none border-0 bg-background p-3 text-sm leading-relaxed outline-none"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="正文"
          />
        </>
      )}
    </div>
  );
}
