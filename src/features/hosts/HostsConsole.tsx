/**
 * @file 主机控制台
 * @author Charlie
 * @description 主机列表主界面：搜索筛选、分组侧栏、卡片网格与表单弹窗。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GroupSidebar } from "@/features/hosts/GroupSidebar";
import { HOST_GROUP_LOCAL, HOST_GROUP_UNGROUPED } from "@/features/hosts/constants";
import { HostCard } from "@/features/hosts/HostCard";
import { HostFormModal } from "@/features/hosts/HostFormModal";
import { HostToolbar } from "@/features/hosts/HostToolbar";
import { LocalShellCard } from "@/features/hosts/LocalShellCard";
import { BatchActionBar } from "@/features/share/BatchActionBar";
import {
  createHost,
  deleteHost,
  GroupRow,
  HostRow,
  listGroups,
  listHosts,
  listTags,
  TagRow,
  updateHost,
} from "@/lib/db";
import { dialogs } from "@/lib/ui/dialogs";
import { startRecordingForOpenTab } from "@/lib/session/recorder";
import { connectLocalShell, connectSshHost } from "@/lib/session/connect";
import { exportToFile, formatImportToast, importFromFile } from "@/lib/share";
import { api, type LocalShellInfo } from "@/lib/tauri";
import {
  findHostByTarget,
  hostMatchesQuery,
  parseSshTarget,
  type SshTarget,
} from "@/lib/session/sshTarget";
import { useUiStore } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
/** 主机管理控制台主组件 */
export function HostsConsole() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [shells, setShells] = useState<LocalShellInfo[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [editing, setEditing] = useState<HostRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [createPrefill, setCreatePrefill] = useState<Partial<HostRow> | null>(
    null,
  );
  const filter = useUiStore((s) => s.hostFilter);
  const setHostFilter = useUiStore((s) => s.setHostFilter);
  const addTab = useUiStore((s) => s.addTab);
  const updateTab = useUiStore((s) => s.updateTab);
  const navigate = useNavigate();
  const defaultLocalShell = useSettingsStore((s) => s.defaultLocalShell);

  const reload = useCallback(async () => {
    const [hostRows, groupRows, tagRows, shellRows] = await Promise.all([
      listHosts(),
      listGroups(),
      listTags(),
      api.listLocalShells().catch(() => [] as LocalShellInfo[]),
    ]);
    setHosts(hostRows);
    setGroups(groupRows);
    setTags(tagRows);
    setShells(shellRows);
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const sshTarget = useMemo(
    () => parseSshTarget(filter.search),
    [filter.search],
  );

  const groupCounts = useMemo(() => {
    const map = new Map<number | "none", number>();
    map.set("none", 0);
    for (const g of groups) map.set(g.id, 0);
    for (const h of hosts) {
      if (h.group_id == null) map.set("none", (map.get("none") || 0) + 1);
      else map.set(h.group_id, (map.get(h.group_id) || 0) + 1);
    }
    return map;
  }, [hosts, groups]);

  const isLocalGroup = filter.groupId === HOST_GROUP_LOCAL;

  const filtered = useMemo(() => {
    if (isLocalGroup) return [];
    let list = [...hosts];
    const q = filter.search.trim();
    const searching = q.length > 0;

    if (searching) {
      list = list.filter((h) => hostMatchesQuery(h, q, sshTarget));
    } else if (filter.groupId === HOST_GROUP_UNGROUPED) {
      list = list.filter((h) => h.group_id == null);
    } else if (filter.groupId != null) {
      list = list.filter((h) => h.group_id === filter.groupId);
    }

    if (filter.tag) {
      list = list.filter((h) =>
        (h.tags || "").split(",").includes(filter.tag!),
      );
    }
    list.sort((a, b) => {
      if (filter.sortBy === "name") return a.name.localeCompare(b.name);
      if (filter.sortBy === "recent") {
        return (b.last_connected_at || "").localeCompare(
          a.last_connected_at || "",
        );
      }
      return (a.last_connected_at ? 0 : 1) - (b.last_connected_at ? 0 : 1);
    });
    return list;
  }, [hosts, filter, sshTarget, isLocalGroup]);

  const filteredShells = useMemo(() => {
    if (!isLocalGroup || filter.tag) return [];
    const q = filter.search.trim().toLowerCase();
    if (!q) return shells;
    return shells.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [shells, filter.search, filter.tag, isLocalGroup]);

  const listTotal = isLocalGroup ? filteredShells.length : filtered.length;

  const matchedByTarget = useMemo(() => {
    if (!sshTarget) return null;
    return findHostByTarget(hosts, sshTarget);
  }, [hosts, sshTarget]);

  const connectHost = async (host: HostRow) => {
    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      title: host.name || host.host,
      kind: "ssh",
      sessionId: null,
      hostId: host.id,
      status: "connecting",
    });
    navigate("/terminal");
    try {
      const { session } = await connectSshHost(host.id);
      const recording = startRecordingForOpenTab(tabId, session.id);
      updateTab(tabId, {
        sessionId: session.id,
        status: "open",
        title: session.title,
      });
      await recording;
      await reload();
    } catch (e) {
      updateTab(tabId, { status: "error" });
      console.error(e);
      await dialogs.alert(String(e));
    }
  };

  const connectShell = async (shell: LocalShellInfo) => {
    navigate("/terminal");
    try {
      await connectLocalShell(shell);
    } catch (e) {
      console.error(e);
      await dialogs.alert(String(e));
    }
  };

  const openCreateFromTarget = (target: SshTarget) => {
    setCreatePrefill({
      name: `${target.username}@${target.host}`,
      host: target.host,
      port: target.port,
      username: target.username,
    });
    setEditing(null);
    setCreating(true);
  };

  const runSearchAction = async () => {
    const q = filter.search.trim();
    if (!q) return;

    if (matchedByTarget) {
      await connectHost(matchedByTarget);
      return;
    }
    if (filtered.length === 1) {
      await connectHost(filtered[0]);
      return;
    }
    if (sshTarget) {
      openCreateFromTarget(sshTarget);
      return;
    }
    if (filtered.length > 0) {
      await connectHost(filtered[0]);
    }
  };

  const activeGroupLabel = useMemo(() => {
    if (filter.search.trim()) {
      return sshTarget
        ? `${sshTarget.username}@${sshTarget.host}:${sshTarget.port}`
        : t("hosts.title");
    }
    if (filter.groupId === HOST_GROUP_UNGROUPED) return t("hosts.ungrouped");
    if (filter.groupId === HOST_GROUP_LOCAL) return t("hosts.localShells");
    if (filter.groupId != null) {
      return (
        groups.find((g) => g.id === filter.groupId)?.name || t("hosts.title")
      );
    }
    return t("hosts.title");
  }, [filter.groupId, filter.search, groups, sshTarget, t]);

  const targetLabel = sshTarget
    ? `${sshTarget.username}@${sshTarget.host}:${sshTarget.port}`
    : "";

  return (
    <div className="flex h-full flex-col">
      <HostToolbar
        search={filter.search}
        tag={filter.tag}
        sortBy={filter.sortBy}
        tags={tags}
        sshTarget={sshTarget}
        matchedByTarget={matchedByTarget}
        filteredCount={filtered.length}
        targetLabel={targetLabel}
        onSearchChange={(value) => setHostFilter({ search: value })}
        onTagChange={(value) => setHostFilter({ tag: value })}
        onSortChange={(value) => setHostFilter({ sortBy: value })}
        onSearchEnter={() => runSearchAction().catch(console.error)}
        onSearchEscape={() => setHostFilter({ search: "" })}
        onNewHost={() => {
          setCreatePrefill(null);
          setCreating(true);
          setEditing(null);
        }}
        onImport={() => {
          importFromFile()
            .then(async (r) => {
              if (!r) return;
              await reload();
              toast.success(
                `${t("share.importDone")} (${formatImportToast(r)})`,
              );
              if (r.errors.length) console.warn(r.errors);
            })
            .catch((e) => toast.error(String(e)));
        }}
        onConnectMatched={(host) => connectHost(host).catch(console.error)}
        onCreateFromTarget={openCreateFromTarget}
      />

      <BatchActionBar
        disabled={isLocalGroup}
        selectedCount={selectedIds.size}
        totalCount={filtered.length}
        onSelectAll={() => setSelectedIds(new Set(filtered.map((h) => h.id)))}
        onClear={() => setSelectedIds(new Set())}
        onExport={() => {
          const ids = [...selectedIds];
          if (!ids.length) {
            toast.error(t("batch.needSelect"));
            return;
          }
          const includeSecrets = window.confirm(
            t("share.exportSecretsConfirm"),
          );
          exportToFile(
            {
              includeHostSecrets: includeSecrets,
              sections: {
                hosts: true,
                scripts: false,
                notes: false,
              },
              hostIds: ids,
            },
            "xuanjian-hosts.json",
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
            await Promise.all(ids.map((id) => deleteHost(id)));
            setSelectedIds(new Set());
            await reload();
          })();
        }}
      />

      <div className="flex min-h-0 flex-1">
        <GroupSidebar
          groups={groups}
          groupCounts={groupCounts}
          hostTotal={hosts.length}
          localShellCount={shells.length}
          groupId={filter.groupId}
          onSelectGroup={(id) => setHostFilter({ groupId: id })}
          onReload={reload}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
            <h2 className="truncate text-sm font-semibold">
              {activeGroupLabel}
            </h2>
            <p className="shrink-0 text-xs text-muted-foreground">
              {t("hosts.hostsCount", { count: listTotal })}
            </p>
          </div>
          {listTotal === 0 ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <span className="text-sm text-muted-foreground">
                {isLocalGroup ? t("hosts.noLocalShells") : t("hosts.empty")}
              </span>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              {isLocalGroup
                ? filteredShells.map((shell) => (
                    <LocalShellCard
                      key={shell.id}
                      shell={shell}
                      isDefault={
                        shell.id === defaultLocalShell ||
                        (!defaultLocalShell && shell.isDefault)
                      }
                      onConnect={(s) => connectShell(s).catch(console.error)}
                    />
                  ))
                : filtered.map((host) => (
                    <HostCard
                      key={host.id}
                      host={host}
                      selected={selectedIds.has(host.id)}
                      onSelectedChange={(sel) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (sel) next.add(host.id);
                          else next.delete(host.id);
                          return next;
                        });
                      }}
                      onConnect={(h) => connectHost(h).catch(console.error)}
                      onEdit={(h) => {
                        setEditing(h);
                        setCreating(false);
                      }}
                      onReload={reload}
                    />
                  ))}
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <HostFormModal
          groups={groups}
          hosts={hosts}
          initial={editing}
          prefill={editing ? null : createPrefill}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setCreatePrefill(null);
          }}
          onSave={async (input) => {
            if (editing) await updateHost(editing.id, input);
            else await createHost(input);
            setCreating(false);
            setEditing(null);
            setCreatePrefill(null);
            setHostFilter({ search: "" });
            await reload();
          }}
          onConnectShell={(shell) => {
            setCreating(false);
            setCreatePrefill(null);
            void connectShell(shell);
          }}
        />
      )}
    </div>
  );
}
