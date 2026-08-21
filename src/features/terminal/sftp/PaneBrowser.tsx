/**
 * @file SFTP 单侧目录浏览器
 * @author Charlie
 * @description 本地/远程目录浏览、勾选、右键菜单与上传等文件操作。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  ArrowUpToLine,
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
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import type { HostRow } from "@/lib/db";
import { api, type SftpEntry } from "@/lib/tauri";
import { enqueueDownload, enqueueUpload } from "@/stores/transfer";
import { clipboardWriteText } from "@/lib/clipboard";
import { useUiStore } from "@/stores/ui";
import {
  openContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "@/components/ContextMenu";
import { useDialog } from "@/components/Dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { PermissionsModal } from "@/features/terminal/PermissionsModal";
import { PathBookmarkButton } from "@/components/PathBookmarkButton";
import { bookmarkScope } from "@/stores/pathBookmarks";
import {
  askOverwrite,
  findDestEntry,
  prepareOverwrite,
  type ConflictCtx,
  type DestEndpoint,
} from "@/lib/transferConflict";
import type { PaneTab, SideSnapshot } from "@/features/terminal/sftp/types";
import { joinPath, parentPath } from "@/features/terminal/sftp/pathUtils";
import { connectHost } from "@/features/terminal/sftp/transferEnqueue";

/** 单侧文件浏览器：目录列表、勾选与上下文操作 */
export function PaneBrowser({
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

  const ensureSession = useCallback(async () => {
    if (tab.kind !== "host" || tab.hostId == null) return null;
    const existing = termTabs.find(
      (x) =>
        tab.hostId != null &&
        x.kind === "ssh" &&
        x.hostId === tab.hostId &&
        x.sessionId,
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
  }, [tab, hosts, termTabs]);
  const ensureSessionRef = useRef(ensureSession);
  ensureSessionRef.current = ensureSession;

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
          if (!sid) sid = await ensureSessionRef.current();
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
    [cwd, tab.kind],
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
        await ensureSessionRef.current();
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
  }, [tab.id, tab.kind]);

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
          const batch = checkedList.length ? checkedList : [entry];
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
            !(await dialog.confirm(t("context.confirmDelete"), {
              danger: true,
            }))
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
        <button
          className="icon-btn icon-btn-sm is-active"
          title={t("terminal.listView")}
        >
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
        {error && (
          <div className="px-2 py-1 text-[11px] text-danger">{error}</div>
        )}
        <button
          className="file-row with-check"
          onClick={() => setCwd(parentPath(cwd, remote))}
        >
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
            <span
              className={`entry-icon ${e.isDir ? "folder-icon" : "file-icon"}`}
            >
              {e.isDir ? <Folder size={14} /> : <File size={14} />}
            </span>
            <span className="truncate">{e.name}</span>
            <span className="truncate muted">{e.modifiedAt || "--"}</span>
            <span className="truncate muted font-mono text-[11px]">
              {e.permissions || "--"}
            </span>
            <span className="truncate muted">
              {e.isDir ? "--" : String(e.size)}
            </span>
            <span className="truncate muted">
              {e.isDir ? t("terminal.folder") : t("terminal.file")}
            </span>
          </button>
        ))}
        {loading && (
          <div className="px-2 py-2 text-[11px] muted">
            {t("terminal.loading")}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-2 py-1 text-[11px] muted">
        <span>
          {visible.length} {t("terminal.items")}
          {checkedList.length > 0
            ? ` · ${checkedList.length} ${t("terminal.selected")}`
            : ""}
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
