/**
 * @file 终端文件浏览器侧栏
 * @author Charlie
 * @description 浏览本地目录或 SSH/SFTP 远程目录，支持上传下载、新建、重命名、权限等。
 * 路径面包屑、搜索、隐藏文件与右键菜单；过大文件禁止在线编辑。
 * 可打开双栏 SFTP 传输、Monaco 编辑器与权限弹窗。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { dialogs } from "@/lib/dialogs";
import { useTranslation } from "react-i18next";
import {
  ArrowUpToLine,
  ArrowLeftRight,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  Home,
  List,
  Pencil,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { api, SftpEntry } from "@/lib/tauri";
import { enqueueDownload, enqueueUpload } from "@/stores/transfer";
import {
  askOverwrite,
  findDestEntry,
  prepareOverwrite,
  type ConflictCtx,
  type DestEndpoint,
} from "@/lib/transferConflict";
import { clipboardWriteText } from "@/lib/clipboard";
import { FileEditorModal, FileEditorTarget } from "@/features/terminal/FileEditorModal";
import { SftpTransferModal } from "@/features/terminal/SftpTransferModal";
import { PermissionsModal } from "@/features/terminal/PermissionsModal";
import {
  openContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "@/components/ContextMenu";
import { PathBookmarkButton } from "@/components/PathBookmarkButton";
import { bookmarkScope } from "@/stores/pathBookmarks";

/** 是否为 Windows 盘符路径 */
function isWindowsPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

/** 拼接子路径（远程用 /，本地按现有分隔符） */
function joinPath(base: string, name: string, remote: boolean) {
  if (remote) {
    return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
  }
  const sep = base.includes("/") && !base.includes("\\") ? "/" : "\\";
  if (base.endsWith("\\") || base.endsWith("/")) return `${base}${name}`;
  return `${base}${sep}${name}`;
}

/** 取父目录路径 */
function parentPath(path: string, remote: boolean) {
  if (remote) {
    const parts = path.replace(/\/+$/, "").split("/");
    parts.pop();
    return parts.length ? parts.join("/") || "/" : "/";
  }
  if (isWindowsPath(path)) {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 1) return `${parts[0] || "C:"}\\`;
    parts.pop();
    const drive = parts[0].endsWith(":") ? parts[0] : parts[0];
    return parts.length === 1 ? `${drive}\\` : parts.join("\\");
  }
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/** 拆成面包屑段（名称 + 绝对路径） */
function pathSegments(path: string, remote: boolean) {
  if (!path) return [];
  if (remote) {
    return path
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .map((name, i, arr) => ({
        name,
        path: "/" + arr.slice(0, i + 1).join("/"),
      }));
  }
  if (isWindowsPath(path)) {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.map((name, i) => ({
      name,
      path: parts.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : ""),
    }));
  }
  return path
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((name, i, arr) => ({
      name,
      path: "/" + arr.slice(0, i + 1).join("/"),
    }));
}

/** 格式化文件大小；目录显示 -- */
function formatSize(size: number, isDir: boolean) {
  if (isDir) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 根据扩展名得到类型展示文案 */
function fileExtType(name: string, isDir: boolean, t: (k: string) => string) {
  if (isDir) return t("terminal.folder");
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "";
  return ext || t("terminal.file");
}

/** 超过 2MB 视为过大，禁止在线编辑 */
function isTooBig(entry: SftpEntry) {
  return entry.size > 2 * 1024 * 1024;
}

/**
 * 文件浏览器面板：本地 / SFTP 目录浏览与常见文件操作。
 */
export function TerminalSidePanel({
  sessionId,
  kind,
  hostId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  hostId?: number | null;
}) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
    const remote = kind === "ssh";
  const [cwd, setCwd] = useState(kind === "ssh" ? "/" : "");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [pathFocus, setPathFocus] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<FileEditorTarget | null>(
    null,
  );
  const [permTarget, setPermTarget] = useState<SftpEntry | null>(null);
  const pathBoxRef = useRef<HTMLDivElement>(null);

  const reload = async (path = cwd) => {
    if (!sessionId && kind === "ssh") {
      setEntries([]);
      return;
    }
    if (!path) return;
    setLoading(true);
    try {
      setError(null);
      const list =
        kind === "ssh" && sessionId
          ? await api.sftpList(sessionId, path || "/")
          : await api.listLocalDir(path);
      setEntries(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (kind === "local" && !cwd) {
      api.getHomeDir().then((home) => {
        setCwd(home);
        setPathInput(home);
      });
    }
    if (kind === "ssh") {
      setCwd("/");
      setPathInput("/");
    }
  }, [kind]);

  useEffect(() => {
    if (cwd) {
      setPathInput(cwd);
      reload(cwd);
    }
  }, [sessionId, kind, cwd]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!pathBoxRef.current?.contains(e.target as Node)) setPathFocus(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const segments = useMemo(() => pathSegments(cwd, remote), [cwd, remote]);

  const visible = useMemo(() => {
    let list = [...entries];
    if (!showHidden) list = list.filter((e) => !e.name.startsWith("."));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      const cmp = a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
      });
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [entries, showHidden, query, sortAsc]);

  const suggestions = useMemo(() => {
    if (!pathFocus) return [];
    const input = pathInput.replace(/\\/g, "/").toLowerCase();
    const prefix = (() => {
      const parts = pathInput.replace(/\\/g, "/").split("/");
      return (parts.pop() || "").toLowerCase();
    })();
    return entries
      .filter((e) => e.isDir)
      .filter(
        (e) =>
          !prefix ||
          e.name.toLowerCase().startsWith(prefix) ||
          e.path.toLowerCase().includes(input),
      )
      .slice(0, 8)
      .map((e) => e.path);
  }, [pathFocus, pathInput, entries]);

  const goHome = async () => {
    if (remote) {
      setCwd("/");
      return;
    }
    const home = await api.getHomeDir();
    setCwd(home);
  };

  const goParent = () => setCwd(parentPath(cwd, remote));

  const commitPath = (path: string) => {
    const next = path.trim();
    if (!next) return;
    setCwd(next);
    setPathFocus(false);
  };

  const openFile = async (entry: SftpEntry) => {
    if (isTooBig(entry)) {
      await dialogs.alert(t("terminal.fileTooLarge"));
      return;
    }
    setEditorTarget({
      path: entry.path,
      remote,
      sessionId: remote ? sessionId : null,
    });
  };

  const onUpload = async () => {
    if (kind !== "ssh" || !sessionId) return;
    const file = await open({ multiple: true });
    if (!file) return;
    const paths = Array.isArray(file) ? file : [file];
    const conflict: ConflictCtx = { mode: "ask" };
    const destEp: DestEndpoint = { remote: true, sessionId };
    for (const p of paths) {
      const name = p.replace(/\\/g, "/").split("/").pop()!;
      const destPath = joinPath(cwd, name, true);
      const existing = await findDestEntry(destEp, cwd, name);
      if (existing) {
        const decision = await askOverwrite(
          dialogs,
          t,
          conflict,
          destPath,
          existing.isDir,
          false,
        );
        if (decision === "abort") break;
        if (decision === "skip") continue;
        await prepareOverwrite(destEp, destPath, existing, false);
      }
      enqueueUpload(sessionId, p, destPath);
    }
  };

  const onNewFolder = async () => {
    const name = await dialogs.prompt(t("terminal.newFolder"), {
      title: t("context.newFolder"),
    });
    if (!name?.trim()) return;
    const target = joinPath(cwd, name.trim(), remote);
    if (remote && sessionId) await api.sftpMkdir(sessionId, target);
    else await api.createLocalDir(target);
    await reload();
  };

  const onNewFile = async () => {
    const name = await dialogs.prompt(t("terminal.fileNamePrompt"), {
      title: t("context.newFile"),
    });
    if (!name?.trim()) return;
    const target = joinPath(cwd, name.trim(), remote);
    if (remote && sessionId) await api.sftpWrite(sessionId, target, "");
    else await api.writeLocalFile(target, "");
    await reload();
    setEditorTarget({
      path: target,
      remote,
      sessionId: remote ? sessionId : null,
    });
  };

  const copyPath = async (path: string) => {
    try {
      await clipboardWriteText(path);
    } catch {
      /* ignore */
    }
  };

  const deleteEntry = async (entry: SftpEntry) => {
    if (!(await dialogs.confirm(t("context.confirmDelete"), { danger: true })))
      return;
    try {
      if (remote && sessionId) {
        await api.sftpRemove(sessionId, entry.path, entry.isDir);
      } else {
        await api.removeLocalPath(entry.path);
      }
      await reload();
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const downloadEntry = async (entry: SftpEntry) => {
    if (!remote || !sessionId || entry.isDir) return;
    const dest = await save({ defaultPath: entry.name });
    if (!dest) return;
    enqueueDownload(sessionId, entry.path, dest, entry.size);
  };

  const renameEntry = async (entry: SftpEntry) => {
    const name = await dialogs.prompt(t("context.renamePrompt"), {
      title: t("context.rename"),
      defaultValue: entry.name,
    });
    if (!name?.trim() || name.trim() === entry.name) return;
    const next = joinPath(cwd, name.trim(), remote);
    try {
      if (remote && sessionId)
        await api.sftpRename(sessionId, entry.path, next);
      else await api.renameLocalPath(entry.path, next);
      await reload();
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const chmodEntry = (entry: SftpEntry) => {
    setPermTarget(entry);
  };

  const moveToParent = async (entry: SftpEntry) => {
    const parent = parentPath(cwd, remote);
    const next = joinPath(parent, entry.name, remote);
    try {
      if (remote && sessionId)
        await api.sftpRename(sessionId, entry.path, next);
      else await api.renameLocalPath(entry.path, next);
      await reload();
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const commonBlankItems = (): ContextMenuItem[] => [
    {
      id: "refresh",
      label: t("context.refresh"),
      icon: <RefreshCw size={14} />,
      onClick: () => {
        reload().catch(console.error);
      },
    },
    "sep",
    {
      id: "newFolder",
      label: t("context.newFolder"),
      icon: <FolderPlus size={14} />,
      onClick: () => {
        onNewFolder().catch(console.error);
      },
    },
    {
      id: "newFile",
      label: t("context.newFile"),
      icon: <FilePlus size={14} />,
      onClick: () => {
        onNewFile().catch(console.error);
      },
    },
    ...(kind === "ssh"
      ? ([
          {
            id: "upload",
            label: t("context.uploadHere"),
            icon: <Upload size={14} />,
            onClick: () => {
              onUpload().catch(console.error);
            },
          },
        ] as ContextMenuItem[])
      : []),
  ];

  const blankMenuItems = (): ContextMenuItem[] => [
    ...commonBlankItems(),
    "sep",
    {
      id: "hidden",
      label: showHidden ? t("context.hideHidden") : t("context.showHidden"),
      icon: <Eye size={14} />,
      onClick: () => setShowHidden((v) => !v),
    },
  ];

  const entryMenuItems = (entry: SftpEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: "open",
        label: entry.isDir ? t("context.open") : t("context.edit"),
        icon: entry.isDir ? <Folder size={14} /> : <Pencil size={14} />,
        onClick: () => {
          if (entry.isDir) setCwd(entry.path);
          else openFile(entry);
        },
      },
    ];

    if (entry.isDir) {
      items.push({
        id: "jump",
        label: t("context.jumpHere"),
        icon: <ExternalLink size={14} />,
        onClick: () => setCwd(entry.path),
      });
    } else if (!remote) {
      items.push({
        id: "openDefault",
        label: t("context.openDefault"),
        icon: <ExternalLink size={14} />,
        onClick: () => {
          openPath(entry.path).catch((e) => {
            dialogs.alert(String(e)).catch(() => undefined);
          });
        },
      });
    }

    if (remote && !entry.isDir) {
      items.push({
        id: "download",
        label: t("context.download"),
        icon: <Download size={14} />,
        onClick: () => {
          downloadEntry(entry).catch(console.error);
        },
      });
    }

    items.push(
      "sep",
      {
        id: "copy",
        label: t("context.copyPath"),
        icon: <File size={14} />,
        onClick: () => {
          copyPath(entry.path).catch(console.error);
        },
      },
      "sep",
      {
        id: "moveUp",
        label: t("context.moveUp"),
        icon: <ArrowUpToLine size={14} />,
        onClick: () => {
          moveToParent(entry).catch(console.error);
        },
      },
      {
        id: "rename",
        label: t("context.rename"),
        icon: <Pencil size={14} />,
        onClick: () => {
          renameEntry(entry).catch(console.error);
        },
      },
      {
        id: "perms",
        label: t("context.permissions"),
        icon: <Shield size={14} />,
        onClick: () => {
          chmodEntry(entry);
        },
      },
      {
        id: "delete",
        label: t("context.delete"),
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => {
          deleteEntry(entry).catch(console.error);
        },
      },
      "sep",
      ...commonBlankItems(),
    );
    return items;
  };

  return (
    <div
      className="file-browser flex h-full flex-col bg-sidebar text-sidebar-foreground"
      onContextMenu={(e) => openContextMenu(e, openMenu, blankMenuItems())}
    >
      {/* —— 面包屑导航 —— */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={goHome}
          title="Home"
          aria-label="Home"
        >
          <Home size={14} />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden text-xs">
          {segments.length === 0 ? (
            <span className="text-muted-foreground">{remote ? "/" : cwd}</span>
          ) : (
            segments.map((seg, i) => (
              <button
                key={seg.path}
                className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setCwd(seg.path)}
              >
                {i > 0 && <ChevronRight size={12} className="opacity-50" />}
                <span>{seg.name}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* —— 路径输入与补全 —— */}
      <div
        className="relative border-b border-border px-2 py-2"
        ref={pathBoxRef}
      >
        <Input
          className="h-7 text-xs"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onFocus={() => setPathFocus(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitPath(pathInput);
            if (e.key === "Escape") {
              setPathInput(cwd);
              setPathFocus(false);
            }
          }}
        />
        {pathFocus && suggestions.length > 0 && (
          <div className="absolute top-full right-2 left-2 z-20 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
            {suggestions.map((p) => (
              <button
                type="button"
                key={p}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => commitPath(p)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-primary">
                  <Folder size={12} />
                </span>
                <span className="truncate">{p}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* —— 工具条 —— */}
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <PathBookmarkButton
          scope={bookmarkScope({ kind, hostId })}
          path={cwd}
          onNavigate={(p) => {
            setCwd(p);
            setPathInput(p);
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("terminal.sftp")}
          aria-label={t("terminal.sftp")}
          onClick={() => setTransferOpen(true)}
        >
          <ArrowLeftRight size={14} />
        </Button>
        {kind === "ssh" && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title={t("terminal.upload")}
            aria-label={t("terminal.upload")}
            onClick={onUpload}
          >
            <Upload size={14} />
          </Button>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          title={t("terminal.listView")}
          aria-label={t("terminal.listView")}
        >
          <List size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={showSearch ? "secondary" : "ghost"}
          title={t("terminal.search")}
          aria-label={t("terminal.search")}
          onClick={() => setShowSearch((v) => !v)}
        >
          <Search size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("terminal.newFolder")}
          aria-label={t("terminal.newFolder")}
          onClick={onNewFolder}
        >
          <FolderPlus size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("terminal.newFile")}
          aria-label={t("terminal.newFile")}
          onClick={onNewFile}
        >
          <FilePlus size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={showHidden ? "secondary" : "ghost"}
          title={t("terminal.showHidden")}
          aria-label={t("terminal.showHidden")}
          onClick={() => setShowHidden((v) => !v)}
        >
          <Eye size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("terminal.refresh")}
          aria-label={t("terminal.refresh")}
          onClick={() => reload()}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {showSearch && (
        <div className="border-b border-border px-2 py-1.5">
          <Input
            autoFocus
            className="h-7 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("terminal.search")}
          />
        </div>
      )}

      {/* —— 表头 —— */}
      <div className="grid shrink-0 grid-cols-[20px_minmax(100px,1.5fr)_108px_86px_60px_48px] items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span />
        <button
          type="button"
          className="flex items-center gap-1 text-left hover:text-foreground"
          onClick={() => setSortAsc((v) => !v)}
        >
          {t("terminal.name")}
          <span className="text-primary">{sortAsc ? "↑" : "↓"}</span>
        </button>
        <span>{t("terminal.modified")}</span>
        <span>{t("terminal.permissions")}</span>
        <span>{t("terminal.size")}</span>
        <span>{t("terminal.type")}</span>
      </div>

      {/* —— 文件列表 —— */}
      <div
        className="min-h-0 flex-1 overflow-auto p-1"
        onContextMenu={(e) => openContextMenu(e, openMenu, blankMenuItems())}
      >
        {error && (
          <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>
        )}
        <button
          type="button"
          className="grid w-full grid-cols-[20px_minmax(100px,1.5fr)_108px_86px_60px_48px] items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
          onClick={goParent}
        >
          <span className="flex size-5 items-center justify-center text-primary">
            <Folder size={14} />
          </span>
          <span className="truncate font-medium">..</span>
          <span className="truncate text-muted-foreground">--</span>
          <span className="truncate text-muted-foreground">--</span>
          <span className="truncate text-muted-foreground">--</span>
          <span className="truncate text-muted-foreground">
            {t("terminal.folder")}
          </span>
        </button>
        {visible.map((e) => (
          <button
            type="button"
            key={e.path}
            className="grid w-full grid-cols-[20px_minmax(100px,1.5fr)_108px_86px_60px_48px] items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
            onDoubleClick={() => {
              if (e.isDir) setCwd(e.path);
              else openFile(e);
            }}
            onClick={() => {
              if (e.isDir) setCwd(e.path);
            }}
            onContextMenu={(ev) =>
              openContextMenu(ev, openMenu, entryMenuItems(e))
            }
          >
            <span
              className={`flex size-5 items-center justify-center ${
                e.isDir ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {e.isDir ? <Folder size={14} /> : <File size={14} />}
            </span>
            <span className="truncate">{e.name}</span>
            <span className="truncate text-muted-foreground">
              {e.modifiedAt || "--"}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {e.permissions || "--"}
            </span>
            <span className="truncate text-muted-foreground">
              {formatSize(e.size, e.isDir)}
            </span>
            <span className="truncate text-muted-foreground">
              {fileExtType(e.name, e.isDir, t)}
            </span>
          </button>
        ))}
      </div>

      {/* —— 关联弹层：SFTP / 编辑器 / 权限 —— */}
      {transferOpen && (
        <SftpTransferModal
          onClose={() => setTransferOpen(false)}
          defaultHostId={hostId}
        />
      )}
      {editorTarget && (
        <FileEditorModal
          target={editorTarget}
          onClose={() => setEditorTarget(null)}
          onSaved={() => reload()}
        />
      )}
      {permTarget && (
        <PermissionsModal
          path={permTarget.path}
          permissions={permTarget.permissions}
          onClose={() => setPermTarget(null)}
          onApply={async (mode) => {
            if (remote && sessionId) {
              await api.sftpChmod(sessionId, permTarget.path, mode);
            } else {
              await api.chmodLocalPath(permTarget.path, mode);
            }
            await reload();
          }}
        />
      )}
    </div>
  );
}
