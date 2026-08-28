/**
 * @file 移动端远端文件浏览器 + 文本编辑
 */

import {
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MobileTopBar } from "@/features/mobile/MobileTopBar";
import { joinPath, parentPath } from "@/features/terminal/sftp/pathUtils";
import { dialogs } from "@/lib/ui/dialogs";
import { api, type SftpEntry } from "@/lib/tauri";
import { useUiStore } from "@/stores/ui";

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

function isLikelyText(name: string): boolean {
  const ext = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : "";
  if (!ext) return true;
  const textExts = new Set([
    "txt",
    "md",
    "json",
    "yml",
    "yaml",
    "toml",
    "ini",
    "conf",
    "cfg",
    "env",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "py",
    "js",
    "ts",
    "tsx",
    "jsx",
    "css",
    "html",
    "xml",
    "sql",
    "log",
    "rs",
    "go",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "cs",
    "rb",
    "php",
    "dockerfile",
  ]);
  return textExts.has(ext) || name === "Dockerfile" || name === "Makefile";
}

export function MobileFilesPage() {
  const navigate = useNavigate();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);

  const sessionTab = useMemo(() => {
    const ssh = tabs.filter((t) => t.kind === "ssh" && t.sessionId);
    return ssh.find((t) => t.id === activeTabId) ?? ssh[ssh.length - 1] ?? null;
  }, [tabs, activeTabId]);

  const sessionId = sessionTab?.sessionId ?? null;
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!sessionId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.sftpList(sessionId, cwd || "/");
      list.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, cwd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const segments = useMemo(() => {
    const parts = cwd.split("/").filter(Boolean);
    return parts;
  }, [cwd]);

  const openEntry = async (e: SftpEntry) => {
    if (e.isDir) {
      setCwd(e.path);
      return;
    }
    if (e.size > MAX_EDIT_BYTES) {
      toast.error("文件超过 2MB，请在桌面端处理");
      return;
    }
    if (!isLikelyText(e.name)) {
      const ok = await dialogs.confirm("该文件可能不是文本，仍要打开编辑吗？");
      if (!ok) return;
    }
    navigate(
      `/m/files/edit?path=${encodeURIComponent(e.path)}&sid=${encodeURIComponent(sessionId!)}`,
    );
  };

  const mkdir = async () => {
    if (!sessionId) return;
    const name = window.prompt("新建文件夹名称");
    if (!name?.trim()) return;
    try {
      await api.sftpMkdir(sessionId, joinPath(cwd, name.trim(), true));
      await reload();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const mkfile = async () => {
    if (!sessionId) return;
    const name = window.prompt("新建文件名称");
    if (!name?.trim()) return;
    const path = joinPath(cwd, name.trim(), true);
    try {
      await api.sftpWrite(sessionId, path, "");
      await reload();
      navigate(
        `/m/files/edit?path=${encodeURIComponent(path)}&sid=${encodeURIComponent(sessionId)}`,
      );
    } catch (e) {
      toast.error(String(e));
    }
  };

  const removeEntry = async (e: SftpEntry) => {
    if (!sessionId) return;
    const ok = await dialogs.confirm(`删除 ${e.name}？`, { danger: true });
    if (!ok) return;
    try {
      await api.sftpRemove(sessionId, e.path, e.isDir);
      await reload();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const renameEntry = async (e: SftpEntry) => {
    if (!sessionId) return;
    const name = window.prompt("新名称", e.name);
    if (!name?.trim() || name.trim() === e.name) return;
    const next = joinPath(parentPath(e.path, true), name.trim(), true);
    try {
      await api.sftpRename(sessionId, e.path, next);
      await reload();
    } catch (err) {
      toast.error(String(err));
    }
  };

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col">
        <MobileTopBar title="文件" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            请先连接 SSH 主机后再浏览远端文件
          </p>
          <Button type="button" size="sm" onClick={() => navigate("/m")}>
            去主机列表
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MobileTopBar
        title={sessionTab?.title || "文件"}
        right={
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="新建文件"
              onClick={() => void mkfile()}
            >
              <FilePlus size={16} />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="新建文件夹"
              onClick={() => void mkdir()}
            >
              <FolderPlus size={16} />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="刷新"
              onClick={() => void reload()}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
        }
      />
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5 text-xs">
        <button
          type="button"
          className="shrink-0 text-primary"
          onClick={() => setCwd("/")}
        >
          /
        </button>
        {segments.map((seg, i) => {
          const path = "/" + segments.slice(0, i + 1).join("/");
          return (
            <span key={path} className="flex shrink-0 items-center gap-1">
              <ChevronRight size={12} className="text-muted-foreground" />
              <button
                type="button"
                className="text-primary"
                onClick={() => setCwd(path)}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-4 text-xs text-destructive">{error}</p>
        ) : null}
        {cwd !== "/" ? (
          <button
            type="button"
            className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left text-sm"
            onClick={() => setCwd(parentPath(cwd, true))}
          >
            <Folder size={18} className="text-primary" />
            <span>..</span>
          </button>
        ) : null}
        {entries.map((e) => (
          <div
            key={e.path}
            className="flex items-center gap-1 border-b border-border/60"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left text-sm"
              onClick={() => void openEntry(e)}
            >
              {e.isDir ? (
                <Folder size={18} className="shrink-0 text-primary" />
              ) : (
                <File size={18} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
            </button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="重命名"
              onClick={() => void renameEntry(e)}
            >
              <Pencil size={14} />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-destructive"
              aria-label="删除"
              onClick={() => void removeEntry(e)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {!loading && entries.length === 0 && !error ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            空目录
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** 全屏轻量文本编辑（不上 Monaco） */
export function MobileFileEditorPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") || "";
  const sessionId = params.get("sid") || "";
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dirty = content !== original;
  const name = path.replace(/\\/g, "/").split("/").pop() || path;

  useEffect(() => {
    if (!path || !sessionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .sftpRead(sessionId, path)
      .then((text) => {
        setContent(text);
        setOriginal(text);
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false));
  }, [path, sessionId]);

  const save = async () => {
    if (!sessionId || !path) return;
    setSaving(true);
    try {
      await api.sftpWrite(sessionId, path, content);
      setOriginal(content);
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
        title={dirty ? `• ${name}` : name}
        onBack={() => navigate("/m/files")}
        right={
          <Button
            type="button"
            size="xs"
            disabled={!dirty || saving || loading}
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
        <textarea
          className="min-h-0 flex-1 resize-none border-0 bg-background p-3 font-mono text-xs leading-relaxed outline-none"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      )}
      {!path || !sessionId ? (
        <p className="p-4 text-sm text-destructive">缺少文件路径或会话</p>
      ) : null}
    </div>
  );
}
