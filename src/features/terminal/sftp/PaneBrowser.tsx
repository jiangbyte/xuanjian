/**
 * @file SFTP 单侧目录浏览器
 * @author Charlie
 * @description 本地/远程目录浏览、勾选、右键菜单与上传等文件操作。
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContextMenuItem,
  openContextMenu,
  useContextMenu,
} from "@/components/ContextMenu";
import { PathBookmarkButton } from "@/components/PathBookmarkButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PermissionsModal } from "@/features/terminal/PermissionsModal";
import { joinPath, parentPath } from "@/features/terminal/sftp/pathUtils";
import { connectHost } from "@/features/terminal/sftp/transferEnqueue";
import type { PaneTab, SideSnapshot } from "@/features/terminal/sftp/types";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import type { HostRow } from "@/lib/db";
import { dialogs } from "@/lib/ui/dialogs";
import { api, type SftpEntry } from "@/lib/tauri";
import {
  askOverwrite,
  type ConflictCtx,
  type DestEndpoint,
  findDestEntry,
  prepareOverwrite,
} from "@/lib/transfer/conflict";
import { bookmarkScope } from "@/stores/pathBookmarks";
import { enqueueDownload, enqueueUpload } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

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
    const name = await dialogs.prompt(t("context.newFolder"), {
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
    const name = await dialogs.prompt(t("terminal.fileNamePrompt"), {
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
              dialogs,
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
          const name = await dialogs.prompt(t("context.renamePrompt"), {
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
            !(await dialogs.confirm(t("context.confirmDelete"), {
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
      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <Input
          className="h-7 text-xs"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") reload(cwd);
          }}
        />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
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
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("context.copyToOther")}
          aria-label={t("context.copyToOther")}
          disabled={checkedList.length === 0 && !selected}
          onClick={() =>
            onTransferEntry(
              checkedList.length ? checkedList : selected ? [selected] : [],
            )
          }
        >
          <ArrowLeftRight size={14} />
        </Button>
        {remote && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title={t("terminal.upload")}
            aria-label={t("terminal.upload")}
            onClick={() => {
              onUpload().catch(console.error);
            }}
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
          onClick={() => {
            onNewFolder().catch(console.error);
          }}
        >
          <FolderPlus size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("terminal.newFile")}
          aria-label={t("terminal.newFile")}
          onClick={() => {
            onNewFile().catch(console.error);
          }}
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
          onClick={() => reload(cwd)}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {showSearch && (
        <div className="shrink-0 border-b border-border px-2 py-1.5">
          <Input
            autoFocus
            className="h-7 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("terminal.search")}
          />
        </div>
      )}

      <div className="grid shrink-0 grid-cols-[24px_20px_minmax(100px,1.5fr)_108px_86px_60px_48px] items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <span className="flex items-center justify-center">
          <Checkbox
            checked={allVisibleChecked}
            onCheckedChange={() => toggleAllVisible()}
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
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {error && (
          <div className="px-2 py-1 text-xs text-destructive">{error}</div>
        )}
        <button
          type="button"
          className="grid w-full grid-cols-[24px_20px_minmax(100px,1.5fr)_108px_86px_60px_48px] items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
          onClick={() => setCwd(parentPath(cwd, remote))}
        >
          <span />
          <span className="flex size-5 items-center justify-center text-primary">
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
            type="button"
            key={e.path}
            className={`grid w-full grid-cols-[24px_20px_minmax(100px,1.5fr)_108px_86px_60px_48px] items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ${
              selected?.path === e.path ? "bg-accent" : ""
            }`}
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
              className="flex items-center justify-center"
              onClick={(ev) => {
                ev.stopPropagation();
              }}
            >
              <Checkbox
                checked={!!checked[e.path]}
                onCheckedChange={() => toggleCheck(e)}
              />
            </span>
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
            <span className="truncate font-mono text-xs text-muted-foreground">
              {e.permissions || "--"}
            </span>
            <span className="truncate text-muted-foreground">
              {e.isDir ? "--" : String(e.size)}
            </span>
            <span className="truncate text-muted-foreground">
              {e.isDir ? t("terminal.folder") : t("terminal.file")}
            </span>
          </button>
        ))}
        {loading && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("terminal.loading")}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
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
