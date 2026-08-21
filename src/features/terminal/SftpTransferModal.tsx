import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpToLine,
  Computer,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FloatingWindow } from "../../components/FloatingWindow";
import { HostRow, listHosts } from "../../lib/db";
import { api, SftpEntry } from "../../lib/tauri";
import {
  enqueueDownload,
  enqueueRemoteCopy,
  enqueueUpload,
} from "../../stores/transfer";
import { clipboardWriteText } from "../../lib/clipboard";
import { useUiStore } from "../../stores/ui";
import {
  openContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "../../components/ContextMenu";
import { useDialog, type DialogApi } from "../../components/Dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { PermissionsModal } from "./PermissionsModal";
import { PathBookmarkButton } from "../../components/PathBookmarkButton";
import { bookmarkScope } from "../../stores/pathBookmarks";
import {
  askOverwrite,
  findDestEntry,
  prepareOverwrite,
  type ConflictCtx,
  type DestEndpoint,
} from "../../lib/transferConflict";

type Side = "left" | "right";

type PaneTab = {
  id: string;
  kind: "local" | "host";
  hostId?: number;
  label: string;
};

type SideEndpoint = {
  cwd: string;
  sessionId: string | null;
  remote: boolean;
};

type SideSnapshot = SideEndpoint & {
  selected: SftpEntry | null;
  checked: SftpEntry[];
  ready: boolean;
  reload: () => Promise<void>;
};

function isWindowsPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

function joinPath(base: string, name: string, remote: boolean) {
  if (remote) {
    return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
  }
  const sep = base.includes("/") && !base.includes("\\") ? "/" : "\\";
  if (base.endsWith("\\") || base.endsWith("/")) return `${base}${name}`;
  return `${base}${sep}${name}`;
}

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
    const drive = parts[0];
    return parts.length === 1 ? `${drive}\\` : parts.join("\\");
  }
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

function hostTitle(h: HostRow) {
  return h.name || h.host;
}

async function connectHost(host: HostRow) {
  return api.sshConnect({
    host: host.host,
    port: host.port,
    username: host.username,
    authType: host.auth_type === "private_key" ? "privateKey" : host.auth_type,
    password: host.password_enc,
    privateKeyPath: host.private_key_path,
    passphrase: host.passphrase_enc,
    title: host.name,
    terminalType: host.terminal_type,
  });
}

async function listSide(ep: SideEndpoint, path: string) {
  if (ep.remote) {
    if (!ep.sessionId) throw new Error("session missing");
    return api.sftpList(ep.sessionId, path || "/");
  }
  return api.listLocalDir(path);
}

async function ensureDir(ep: SideEndpoint, path: string) {
  if (ep.remote) {
    if (!ep.sessionId) throw new Error("session missing");
    try {
      await api.sftpMkdir(ep.sessionId, path);
    } catch {
      /* may already exist */
    }
  } else {
    await api.createLocalDir(path);
  }
}

async function enqueueTransferFile(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  size?: number,
) {
  if (!src.remote && dst.remote) {
    if (!dst.sessionId) throw new Error("dest session missing");
    enqueueUpload(dst.sessionId, srcPath, destPath, size);
  } else if (src.remote && !dst.remote) {
    if (!src.sessionId) throw new Error("source session missing");
    enqueueDownload(src.sessionId, srcPath, destPath, size);
  } else if (src.remote && dst.remote) {
    if (!src.sessionId || !dst.sessionId) throw new Error("sessions missing");
    enqueueRemoteCopy(
      src.sessionId,
      dst.sessionId,
      srcPath,
      destPath,
      size,
    );
  } else {
    const content = await api.readLocalFile(srcPath);
    await api.writeLocalFile(destPath, content);
  }
}

async function enqueueTransferTree(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  isDir: boolean,
  size: number | undefined,
  dialog: DialogApi,
  t: (key: string, opts?: Record<string, unknown>) => string,
  conflict: ConflictCtx,
): Promise<"ok" | "abort"> {
  const destEp: DestEndpoint = {
    remote: dst.remote,
    sessionId: dst.sessionId,
  };
  const parent = parentPath(destPath, dst.remote);
  const name = destPath.replace(/\\/g, "/").split("/").pop()!;
  const existing = await findDestEntry(destEp, parent, name);

  if (existing) {
    const decision = await askOverwrite(
      dialog,
      t,
      conflict,
      destPath,
      existing.isDir,
      isDir,
    );
    if (decision === "abort") return "abort";
    if (decision === "skip") return "ok";
    await prepareOverwrite(destEp, destPath, existing, isDir);
  }

  if (!isDir) {
    await enqueueTransferFile(src, dst, srcPath, destPath, size);
    return "ok";
  }
  await ensureDir(dst, destPath);
  const children = await listSide(src, srcPath);
  for (const child of children) {
    const result = await enqueueTransferTree(
      src,
      dst,
      child.path,
      joinPath(destPath, child.name, dst.remote),
      child.isDir,
      child.size,
      dialog,
      t,
      conflict,
    );
    if (result === "abort") return "abort";
  }
  return "ok";
}

function HostPicker({
  side,
  hosts,
  onClose,
  onPickLocal,
  onPickHost,
}: {
  side: Side;
  hosts: HostRow[];
  onClose: () => void;
  onPickLocal: () => void;
  onPickHost: (host: HostRow) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(query) ||
        h.host.toLowerCase().includes(query) ||
        h.username.toLowerCase().includes(query),
    );
  }, [hosts, q]);

  return (
    <div className="overlay z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="modal-card flex w-full max-w-md flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <input
            autoFocus
            className="field field-sm flex-1"
            placeholder={t("terminal.searchHosts")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="chip chip-accent">
            {side === "left" ? t("terminal.leftSide") : t("terminal.rightSide")}
          </span>
          <button className="icon-btn icon-btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-auto px-2 py-2">
          <section className="menu-section">
            <div className="menu-section-title">{t("terminal.localMachine")}</div>
            <div className="menu-list">
              <button
                type="button"
                className="list-row list-row-stack"
                onClick={onPickLocal}
              >
                <span className="list-row-title flex items-center gap-2">
                  <Computer size={14} />
                  {t("terminal.localFs")}
                </span>
                <span className="list-row-sub">{t("terminal.browseLocal")}</span>
              </button>
            </div>
          </section>
          <section className="menu-section">
            <div className="menu-section-title">{t("terminal.hosts")}</div>
            <div className="menu-list">
              {filtered.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="list-row list-row-stack"
                  onClick={() => onPickHost(h)}
                >
                  <span className="list-row-title flex items-center gap-2">
                    <Server size={14} />
                    {hostTitle(h)}
                  </span>
                  <span className="list-row-sub truncate">
                    {h.username}@{h.host}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs muted">
                  {t("hosts.empty")}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PaneBrowser({
  tab,
  hosts,
  snapshotRef,
  onTransferEntry,
}: {
  tab: PaneTab;
  hosts: HostRow[];
  snapshotRef: React.MutableRefObject<SideSnapshot | null>;
  onTransferEntry: (entries: SftpEntry[]) => void;
}) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const dialog = useDialog();
  const termTabs = useUiStore((s) => s.tabs);
  const remote = tab.kind === "host";
  const [cwd, setCwd] = useState(remote ? "/" : "");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selected, setSelected] = useState<SftpEntry | null>(null);
  const [checked, setChecked] = useState<Record<string, SftpEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [permTarget, setPermTarget] = useState<SftpEntry | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const ephemeralRef = useRef(false);

  const ensureSession = async () => {
    if (tab.kind !== "host" || tab.hostId == null) return null;
    const existing = termTabs.find(
      (x) => tab.hostId != null && x.kind === "ssh" && x.hostId === tab.hostId && x.sessionId,
    );
    if (existing?.sessionId) {
      setSessionId(existing.sessionId);
      sessionIdRef.current = existing.sessionId;
      ephemeralRef.current = false;
      return existing.sessionId;
    }
    const host = hosts.find((h) => h.id === tab.hostId);
    if (!host) throw new Error("host not found");
    const sess = await connectHost(host);
    setSessionId(sess.id);
    sessionIdRef.current = sess.id;
    ephemeralRef.current = true;
    return sess.id;
  };

  const reload = useCallback(
    async (path = cwd) => {
      setLoading(true);
      setError(null);
      try {
        if (tab.kind === "local") {
          if (!path) return;
          setEntries(await api.listLocalDir(path));
        } else {
          let sid = sessionIdRef.current;
          if (!sid) sid = await ensureSession();
          if (!sid) return;
          setEntries(await api.sftpList(sid, path || "/"));
        }
      } catch (e) {
        setError(String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cwd, tab, hosts, termTabs],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSelected(null);
      setChecked({});
      setError(null);
      sessionIdRef.current = null;
      setSessionId(null);
      if (tab.kind === "local") {
        const home = await api.getHomeDir();
        if (!cancelled) setCwd(home);
        return;
      }
      setCwd("/");
      try {
        await ensureSession();
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (ephemeralRef.current && sessionIdRef.current) {
        api.sessionClose(sessionIdRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => {
    if (!cwd) return;
    setChecked({});
    reload(cwd);
  }, [cwd, sessionId, reload]);

  const visible = useMemo(() => {
    let list = [...entries];
    if (!showHidden) list = list.filter((e) => !e.name.startsWith("."));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    return list;
  }, [entries, showHidden, query]);

  const checkedList = useMemo(() => Object.values(checked), [checked]);
  const allVisibleChecked =
    visible.length > 0 && visible.every((e) => checked[e.path]);

  const toggleCheck = (entry: SftpEntry, value?: boolean) => {
    setChecked((prev) => {
      const next = { ...prev };
      const on = value ?? !next[entry.path];
      if (on) next[entry.path] = entry;
      else delete next[entry.path];
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleChecked) {
      setChecked((prev) => {
        const next = { ...prev };
        visible.forEach((e) => delete next[e.path]);
        return next;
      });
    } else {
      setChecked((prev) => {
        const next = { ...prev };
        visible.forEach((e) => {
          next[e.path] = e;
        });
        return next;
      });
    }
  };

  snapshotRef.current = {
    cwd,
    selected,
    checked: checkedList,
    sessionId,
    remote,
    ready: tab.kind === "local" || !!sessionId,
    reload: () => reload(cwd),
  };

  const onNewFolder = async () => {
    const name = await dialog.prompt(t("context.newFolder"), {
      title: t("context.newFolder"),
    });
    if (!name?.trim()) return;
    const target = joinPath(cwd, name.trim(), remote);
    if (remote) {
      const sid = sessionIdRef.current || (await ensureSession());
      if (!sid) return;
      await api.sftpMkdir(sid, target);
    } else {
      await api.createLocalDir(target);
    }
    await reload(cwd);
  };

  const onNewFile = async () => {
    const name = await dialog.prompt(t("terminal.fileNamePrompt"), {
      title: t("context.newFile"),
    });
    if (!name?.trim()) return;
    const target = joinPath(cwd, name.trim(), remote);
    if (remote) {
      const sid = sessionIdRef.current || (await ensureSession());
      if (!sid) return;
      await api.sftpWrite(sid, target, "");
    } else {
      await api.writeLocalFile(target, "");
    }
    await reload(cwd);
  };

  const onUpload = async () => {
    if (!remote) return;
    const sid = sessionIdRef.current || (await ensureSession());
    if (!sid) return;
    const file = await openDialog({ multiple: true });
    if (!file) return;
    const paths = Array.isArray(file) ? file : [file];
    const conflict: ConflictCtx = { mode: "ask" };
    const destEp: DestEndpoint = { remote: true, sessionId: sid };
    for (const p of paths) {
      const name = p.replace(/\\/g, "/").split("/").pop()!;
      const destPath = joinPath(cwd, name, true);
      const existing = await findDestEntry(destEp, cwd, name);
      if (existing) {
        const decision = await askOverwrite(
          dialog,
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
      enqueueUpload(sid, p, destPath);
    }
  };

  const blankItems = (): ContextMenuItem[] => [
    {
      id: "refresh",
      label: t("context.refresh"),
      icon: <RefreshCw size={14} />,
      onClick: () => {
        reload(cwd).catch(console.error);
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
    {
      id: "upload",
      label: t("context.uploadHere"),
      icon: <Upload size={14} />,
      disabled: !remote,
      onClick: () => {
        onUpload().catch(console.error);
      },
    },
  ];

  const entryItems = (entry: SftpEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: "open",
        label: entry.isDir ? t("context.open") : t("context.jumpHere"),
        icon: entry.isDir ? <Folder size={14} /> : <ExternalLink size={14} />,
        onClick: () => {
          if (entry.isDir) {
            setCwd(entry.path);
            setSelected(null);
          } else {
            setSelected(entry);
            toggleCheck(entry, true);
          }
        },
      },
      {
        id: "transfer",
        label: t("context.copyToOther"),
        icon: <Copy size={14} />,
        onClick: () => {
          const batch = checkedList.length
            ? checkedList
            : [entry];
          if (!checkedList.some((c) => c.path === entry.path)) {
            onTransferEntry([entry]);
          } else {
            onTransferEntry(batch);
          }
        },
      },
    ];
    if (remote && !entry.isDir) {
      items.push({
        id: "download",
        label: t("context.download"),
        icon: <Download size={14} />,
        onClick: async () => {
          const sid = sessionIdRef.current;
          if (!sid) return;
          const home = await api.getHomeDir();
          const destPath = joinPath(home, entry.name, false);
          const destEp: DestEndpoint = { remote: false, sessionId: null };
          const existing = await findDestEntry(destEp, home, entry.name);
          if (existing) {
            const conflict: ConflictCtx = { mode: "ask" };
            const decision = await askOverwrite(
              dialog,
              t,
              conflict,
              destPath,
              existing.isDir,
              false,
            );
            if (decision !== "overwrite") return;
            await prepareOverwrite(destEp, destPath, existing, false);
          }
          enqueueDownload(sid, entry.path, destPath, entry.size);
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
          clipboardWriteText(entry.path).catch(() => undefined);
        },
      },
      "sep",
      {
        id: "moveUp",
        label: t("context.moveUp"),
        icon: <ArrowUpToLine size={14} />,
        onClick: async () => {
          const next = joinPath(parentPath(cwd, remote), entry.name, remote);
          if (remote) {
            const sid = sessionIdRef.current;
            if (!sid) return;
            await api.sftpRename(sid, entry.path, next);
          } else {
            await api.renameLocalPath(entry.path, next);
          }
          await reload(cwd);
        },
      },
      {
        id: "rename",
        label: t("context.rename"),
        icon: <Pencil size={14} />,
        onClick: async () => {
          const name = await dialog.prompt(t("context.renamePrompt"), {
            title: t("context.rename"),
            defaultValue: entry.name,
          });
          if (!name?.trim() || name.trim() === entry.name) return;
          const next = joinPath(cwd, name.trim(), remote);
          if (remote) {
            const sid = sessionIdRef.current;
            if (!sid) return;
            await api.sftpRename(sid, entry.path, next);
          } else {
            await api.renameLocalPath(entry.path, next);
          }
          await reload(cwd);
        },
      },
      {
        id: "perms",
        label: t("context.permissions"),
        icon: <Shield size={14} />,
        onClick: () => setPermTarget(entry),
      },
      {
        id: "delete",
        label: t("context.delete"),
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: async () => {
          if (
            !(await dialog.confirm(t("context.confirmDelete"), { danger: true }))
          )
            return;
          if (remote) {
            const sid = sessionIdRef.current;
            if (!sid) return;
            await api.sftpRemove(sid, entry.path, entry.isDir);
          } else {
            await api.removeLocalPath(entry.path);
          }
          await reload(cwd);
        },
      },
      "sep",
      ...blankItems(),
    );
    return items;
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={(e) => openContextMenu(e, openMenu, blankItems())}
    >
      <div className="border-b border-[var(--border)] px-2 py-1.5">
        <input
          className="field field-sm"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") reload(cwd);
          }}
        />
      </div>

      <div className="flex items-center gap-0.5 border-b border-[var(--border)] px-1.5 py-1">
        <PathBookmarkButton
          scope={bookmarkScope({
            kind: remote ? "host" : "local",
            hostId: tab.hostId,
          })}
          path={cwd}
          onNavigate={(p) => {
            setCwd(p);
            reload(p).catch(console.error);
          }}
        />
        <button
          className="icon-btn icon-btn-sm"
          title={t("context.copyToOther")}
          disabled={checkedList.length === 0 && !selected}
          onClick={() =>
            onTransferEntry(
              checkedList.length ? checkedList : selected ? [selected] : [],
            )
          }
        >
          <ArrowLeftRight size={14} />
        </button>
        {remote && (
          <button
            className="icon-btn icon-btn-sm"
            title={t("terminal.upload")}
            onClick={() => {
              onUpload().catch(console.error);
            }}
          >
            <Upload size={14} />
          </button>
        )}
        <button className="icon-btn icon-btn-sm is-active" title={t("terminal.listView")}>
          <List size={14} />
        </button>
        <button
          className={`icon-btn icon-btn-sm ${showSearch ? "is-active" : ""}`}
          title={t("terminal.search")}
          onClick={() => setShowSearch((v) => !v)}
        >
          <Search size={14} />
        </button>
        <button
          className="icon-btn icon-btn-sm"
          title={t("terminal.newFolder")}
          onClick={() => {
            onNewFolder().catch(console.error);
          }}
        >
          <FolderPlus size={14} />
        </button>
        <button
          className="icon-btn icon-btn-sm"
          title={t("terminal.newFile")}
          onClick={() => {
            onNewFile().catch(console.error);
          }}
        >
          <FilePlus size={14} />
        </button>
        <button
          className={`icon-btn icon-btn-sm ${showHidden ? "is-active" : ""}`}
          title={t("terminal.showHidden")}
          onClick={() => setShowHidden((v) => !v)}
        >
          <Eye size={14} />
        </button>
        <button
          className="icon-btn icon-btn-sm"
          title={t("terminal.refresh")}
          onClick={() => reload(cwd)}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {showSearch && (
        <div className="border-b border-[var(--border)] px-2 py-1.5">
          <input
            autoFocus
            className="field field-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("terminal.search")}
          />
        </div>
      )}

      <div className="file-table-head with-check">
        <span className="file-check">
          <input
            type="checkbox"
            checked={allVisibleChecked}
            onChange={toggleAllVisible}
            aria-label="select all"
          />
        </span>
        <span />
        <span>{t("terminal.name")}</span>
        <span>{t("terminal.modified")}</span>
        <span>{t("terminal.permissions")}</span>
        <span>{t("terminal.size")}</span>
        <span>{t("terminal.type")}</span>
      </div>
      <div className="panel-body p-1">
        {error && <div className="px-2 py-1 text-[11px] text-danger">{error}</div>}
        <button className="file-row with-check" onClick={() => setCwd(parentPath(cwd, remote))}>
          <span />
          <span className="entry-icon folder-icon">
            <Folder size={14} />
          </span>
          <span className="truncate font-medium">..</span>
          <span />
          <span />
          <span />
          <span />
        </button>
        {visible.map((e) => (
          <button
            key={e.path}
            className={`file-row with-check ${selected?.path === e.path ? "is-selected" : ""}`}
            onClick={() => {
              if (e.isDir) {
                setCwd(e.path);
                setSelected(null);
              } else {
                setSelected(e);
              }
            }}
            onContextMenu={(ev) => openContextMenu(ev, openMenu, entryItems(e))}
          >
            <span
              className="file-check"
              onClick={(ev) => {
                ev.stopPropagation();
              }}
            >
              <input
                type="checkbox"
                checked={!!checked[e.path]}
                onChange={() => toggleCheck(e)}
              />
            </span>
            <span className={`entry-icon ${e.isDir ? "folder-icon" : "file-icon"}`}>
              {e.isDir ? <Folder size={14} /> : <File size={14} />}
            </span>
            <span className="truncate">{e.name}</span>
            <span className="truncate muted">{e.modifiedAt || "--"}</span>
            <span className="truncate muted font-mono text-[11px]">
              {e.permissions || "--"}
            </span>
            <span className="truncate muted">{e.isDir ? "--" : String(e.size)}</span>
            <span className="truncate muted">
              {e.isDir ? t("terminal.folder") : t("terminal.file")}
            </span>
          </button>
        ))}
        {loading && (
          <div className="px-2 py-2 text-[11px] muted">{t("terminal.loading")}</div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-2 py-1 text-[11px] muted">
        <span>
          {visible.length} {t("terminal.items")}
          {checkedList.length > 0 ? ` · ${checkedList.length} ${t("terminal.selected")}` : ""}
        </span>
        <span className="truncate pl-2">{cwd}</span>
      </div>
      {permTarget && (
        <PermissionsModal
          path={permTarget.path}
          permissions={permTarget.permissions}
          onClose={() => setPermTarget(null)}
          onApply={async (mode) => {
            if (remote) {
              const sid = sessionIdRef.current;
              if (!sid) throw new Error("session missing");
              await api.sftpChmod(sid, permTarget.path, mode);
            } else {
              await api.chmodLocalPath(permTarget.path, mode);
            }
            await reload(cwd);
          }}
        />
      )}
    </div>
  );
}

function TransferPane({
  side: _side,
  tabs,
  activeTabId,
  hosts,
  onActivate,
  onCloseTab,
  onAdd,
  snapshotRef,
  onTransferEntry,
}: {
  side: Side;
  tabs: PaneTab[];
  activeTabId: string | null;
  hosts: HostRow[];
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAdd: () => void;
  snapshotRef: React.MutableRefObject<SideSnapshot | null>;
  onTransferEntry: (entries: SftpEntry[]) => void;
}) {
  const { t } = useTranslation();
  void _side;
  const active = tabs.find((x) => x.id === activeTabId) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="flex items-center gap-0.5 border-b border-[var(--border)] px-1 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-chip group ${activeTabId === tab.id ? "active" : ""}`}
              onClick={() => onActivate(tab.id)}
            >
              {tab.kind === "local" ? <Computer size={12} /> : <Server size={12} />}
              <span className="truncate">{tab.label}</span>
              <span
                className="icon-btn icon-btn-sm opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <button className="icon-btn icon-btn-sm" onClick={onAdd} title={t("terminal.pickHost")}>
          <Plus size={14} />
        </button>
      </div>

      {!active ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <div className="text-sm muted">{t("terminal.pickHostFirst")}</div>
          <button className="btn btn-primary" onClick={onAdd}>
            <Plus size={14} />
            {t("terminal.pickHost")}
          </button>
        </div>
      ) : (
        <PaneBrowser
          key={active.id}
          tab={active}
          hosts={hosts}
          snapshotRef={snapshotRef}
          onTransferEntry={onTransferEntry}
        />
      )}
    </div>
  );
}

export function SftpTransferModal({
  onClose,
  defaultHostId,
}: {
  onClose: () => void;
  defaultHostId?: number | null;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [leftTabs, setLeftTabs] = useState<PaneTab[]>([]);
  const [rightTabs, setRightTabs] = useState<PaneTab[]>([]);
  const [leftActive, setLeftActive] = useState<string | null>(null);
  const [rightActive, setRightActive] = useState<string | null>(null);
  const [pickerSide, setPickerSide] = useState<Side | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const leftRef = useRef<SideSnapshot | null>(null);
  const rightRef = useRef<SideSnapshot | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    listHosts().then(setHosts).catch(console.error);
  }, []);

  useEffect(() => {
    if (seeded.current) return;
    if (defaultHostId != null && hosts.length === 0) return;
    seeded.current = true;

    const localTab: PaneTab = {
      id: crypto.randomUUID(),
      kind: "local",
      label: t("terminal.localMachine"),
    };
    setLeftTabs([localTab]);
    setLeftActive(localTab.id);

    if (defaultHostId != null) {
      const host = hosts.find((h) => h.id === defaultHostId);
      if (host) {
        const tab: PaneTab = {
          id: crypto.randomUUID(),
          kind: "host",
          hostId: host.id,
          label: hostTitle(host),
        };
        setRightTabs([tab]);
        setRightActive(tab.id);
      }
    }
  }, [hosts, defaultHostId, t]);

  const addTab = (side: Side, tab: PaneTab) => {
    if (side === "left") {
      setLeftTabs((tabs) => [...tabs, tab]);
      setLeftActive(tab.id);
    } else {
      setRightTabs((tabs) => [...tabs, tab]);
      setRightActive(tab.id);
    }
  };

  const closeTab = (side: Side, id: string) => {
    if (side === "left") {
      setLeftTabs((tabs) => {
        const next = tabs.filter((x) => x.id !== id);
        setLeftActive((cur) => (cur === id ? next[0]?.id ?? null : cur));
        return next;
      });
    } else {
      setRightTabs((tabs) => {
        const next = tabs.filter((x) => x.id !== id);
        setRightActive((cur) => (cur === id ? next[0]?.id ?? null : cur));
        return next;
      });
    }
  };

  const transfer = async (from: Side, forced?: SftpEntry[]) => {
    const src = from === "left" ? leftRef.current : rightRef.current;
    const dst = from === "left" ? rightRef.current : leftRef.current;
    if (!src || !dst) return;
    setBusy(true);
    setMessage(null);
    setOk(false);
    try {
      if (!src.ready || !dst.ready) throw new Error(t("terminal.pickHostFirst"));
      const items =
        forced && forced.length
          ? forced
          : src.checked.length
            ? src.checked
            : src.selected
              ? [src.selected]
              : [];
      if (!items.length) throw new Error(t("terminal.pickFileFirst"));

      const conflict: ConflictCtx = { mode: "ask" };
      let queued = 0;
      for (const item of items) {
        const destPath = joinPath(dst.cwd, item.name, dst.remote);
        const result = await enqueueTransferTree(
          src,
          dst,
          item.path,
          destPath,
          item.isDir,
          item.size,
          dialog,
          t,
          conflict,
        );
        if (result === "abort") {
          setOk(false);
          setMessage(t("transfer.conflictAborted"));
          await dst.reload().catch(() => undefined);
          return;
        }
        queued += 1;
      }
      setOk(true);
      setMessage(
        `${t("transfer.queued")} (${queued} ${t("terminal.items")})`,
      );
      // Destination listing refreshes when jobs finish; peek now for dirs created.
      await dst.reload().catch(() => undefined);
    } catch (e) {
      setOk(false);
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingWindow
      title={t("terminal.sftpTransfer")}
      onClose={onClose}
      initialWidth={1100}
      initialHeight={680}
      bodyClassName="flex min-h-0 flex-col gap-2 overflow-hidden p-3"
      headerActions={
        <div className="flex items-center gap-1">
          <button
            className="icon-btn"
            disabled={busy}
            title={t("terminal.transferLeft")}
            onClick={() => transfer("right")}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="icon-btn"
            disabled={busy}
            title={t("terminal.transferRight")}
            onClick={() => transfer("left")}
          >
            <ArrowRight size={14} />
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => {
              const leftN =
                (leftRef.current?.checked.length || 0) +
                (leftRef.current?.selected ? 1 : 0);
              const rightN =
                (rightRef.current?.checked.length || 0) +
                (rightRef.current?.selected ? 1 : 0);
              if (leftN >= rightN) transfer("left");
              else transfer("right");
            }}
          >
            <ArrowLeftRight size={12} />
            {busy ? t("terminal.transferring") : t("terminal.transfer")}
          </button>
        </div>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <TransferPane
          side="left"
          tabs={leftTabs}
          activeTabId={leftActive}
          hosts={hosts}
          onActivate={setLeftActive}
          onCloseTab={(id) => closeTab("left", id)}
          onAdd={() => setPickerSide("left")}
          snapshotRef={leftRef}
          onTransferEntry={(entries) => {
            if (!entries.length) return;
            leftRef.current = {
              ...(leftRef.current as SideSnapshot),
              checked: entries,
              selected: entries[0],
            };
            transfer("left", entries).catch(console.error);
          }}
        />
        <TransferPane
          side="right"
          tabs={rightTabs}
          activeTabId={rightActive}
          hosts={hosts}
          onActivate={setRightActive}
          onCloseTab={(id) => closeTab("right", id)}
          onAdd={() => setPickerSide("right")}
          snapshotRef={rightRef}
          onTransferEntry={(entries) => {
            if (!entries.length) return;
            rightRef.current = {
              ...(rightRef.current as SideSnapshot),
              checked: entries,
              selected: entries[0],
            };
            transfer("right", entries).catch(console.error);
          }}
        />
      </div>

      {message && (
        <div className={`text-xs ${ok ? "muted" : "text-danger"}`}>{message}</div>
      )}

      {pickerSide && (
        <HostPicker
          side={pickerSide}
          hosts={hosts}
          onClose={() => setPickerSide(null)}
          onPickLocal={() => {
            addTab(pickerSide, {
              id: crypto.randomUUID(),
              kind: "local",
              label: t("terminal.localMachine"),
            });
            setPickerSide(null);
          }}
          onPickHost={(host) => {
            addTab(pickerSide, {
              id: crypto.randomUUID(),
              kind: "host",
              hostId: host.id,
              label: hostTitle(host),
            });
            setPickerSide(null);
          }}
        />
      )}
    </FloatingWindow>
  );
}
