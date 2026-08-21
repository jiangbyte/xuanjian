/**
 * @file 主机控制台
 * @author Charlie
 * @description 主机列表主界面：搜索筛选、分组侧栏、卡片网格与表单弹窗。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GroupSidebar } from "@/features/hosts/GroupSidebar";
import { HostCard } from "@/features/hosts/HostCard";
import { HostFormModal } from "@/features/hosts/HostFormModal";
import { HostToolbar } from "@/features/hosts/HostToolbar";
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
  touchHostConnected,
  updateHost,
} from "@/lib/db";
import { dialogs } from "@/lib/dialogs";
import { startRecordingForOpenTab } from "@/lib/sessionRecorder";
import { exportToFile, formatImportToast, importFromFile } from "@/lib/share";
import {
  findHostByTarget,
  hostMatchesQuery,
  parseSshTarget,
  type SshTarget,
} from "@/lib/sshTarget";
import { api } from "@/lib/tauri";
import { useUiStore } from "@/stores/ui";

/** 主机管理控制台主组件 */
export function HostsConsole() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<HostRow[]>([]);
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

  const reload = async () => {
    setHosts(await listHosts());
    setGroups(await listGroups());
    setTags(await listTags());
  };

  useEffect(() => {
    reload().catch(console.error);
  }, []);

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

  const filtered = useMemo(() => {
    let list = [...hosts];
    const q = filter.search.trim();
    const searching = q.length > 0;

    if (searching) {
      list = list.filter((h) => hostMatchesQuery(h, q, sshTarget));
    } else if (filter.groupId === -1) {
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
  }, [hosts, filter, sshTarget]);

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
      const session = await api.sshConnect({
        host: host.host,
        port: host.port,
        username: host.username,
        authType:
          host.auth_type === "private_key" ? "privateKey" : host.auth_type,
        password: host.password_enc,
        privateKeyPath: host.private_key_path,
        passphrase: host.passphrase_enc,
        title: host.name,
        terminalType: host.terminal_type,
      });
      await touchHostConnected(host.id);
      const recording = startRecordingForOpenTab(tabId, session.id);
      updateTab(tabId, {
        sessionId: session.id,
        status: "open",
        title: session.title,
      });
      await recording;
      if (host.startup_cmd?.trim()) {
        await api.sessionWrite(session.id, `${host.startup_cmd.trim()}\n`);
      }
      await reload();
    } catch (e) {
      updateTab(tabId, { status: "error" });
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
    if (filter.groupId === -1) return t("hosts.ungrouped");
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
                dockerProjects: false,
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
            for (const id of ids) await deleteHost(id);
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
          groupId={filter.groupId}
          onSelectGroup={(id) => setHostFilter({ groupId: id })}
          onReload={reload}
        />

        <div className="flex-1 overflow-auto p-5">
          <h2 className="mb-1 text-lg font-semibold">{activeGroupLabel}</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t("hosts.hostsCount", { count: filtered.length })}
          </p>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center rounded-md border border-dashed border-border p-10">
              <span className="text-muted-foreground">{t("hosts.empty")}</span>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((host) => (
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
        />
      )}
    </div>
  );
}
