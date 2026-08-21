import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Search,
  Server,
} from "lucide-react";
import {
  createGroup,
  createHost,
  deleteGroup,
  deleteHost,
  HostInput,
  HostRow,
  listGroups,
  listHosts,
  listTags,
  moveGroup,
  renameGroup,
  touchHostConnected,
  updateHost,
  GroupRow,
  TagRow,
} from "../../lib/db";
import { api } from "../../lib/tauri";
import { useUiStore } from "../../stores/ui";
import { useNavigate } from "react-router-dom";
import { startRecordingForOpenTab } from "../../lib/sessionRecorder";
import {
  openContextMenu,
  useContextMenu,
} from "../../components/ContextMenu";
import { Select } from "../../components/Select";
import { useDialog } from "../../components/Dialog";
import {
  findHostByTarget,
  hostMatchesQuery,
  parseSshTarget,
  type SshTarget,
} from "../../lib/sshTarget";

export function HostsConsole() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const dialog = useDialog();
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [editing, setEditing] = useState<HostRow | null>(null);
  const [creating, setCreating] = useState(false);
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
      list = list.filter((h) => (h.tags || "").split(",").includes(filter.tag!));
    }
    list.sort((a, b) => {
      if (filter.sortBy === "name") return a.name.localeCompare(b.name);
      if (filter.sortBy === "recent") {
        return (b.last_connected_at || "").localeCompare(a.last_connected_at || "");
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
        authType: host.auth_type === "private_key" ? "privateKey" : host.auth_type,
        password: host.password_enc,
        privateKeyPath: host.private_key_path,
        passphrase: host.passphrase_enc,
        title: host.name,
        terminalType: host.terminal_type,
      });
      await touchHostConnected(host.id);
      const recording = startRecordingForOpenTab(tabId, session.id);
      updateTab(tabId, { sessionId: session.id, status: "open", title: session.title });
      await recording;
      if (host.startup_cmd?.trim()) {
        await api.sessionWrite(session.id, `${host.startup_cmd.trim()}\n`);
      }
      await reload();
    } catch (e) {
      updateTab(tabId, { status: "error" });
      console.error(e);
      await dialog.alert(String(e));
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
      return groups.find((g) => g.id === filter.groupId)?.name || t("hosts.title");
    }
    return t("hosts.title");
  }, [filter.groupId, filter.search, groups, sshTarget, t]);

  const targetLabel = sshTarget
    ? `${sshTarget.username}@${sshTarget.host}:${sshTarget.port}`
    : "";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="field-icon-wrap flex-1">
            <Search size={14} className="field-icon" />
            <input
              className="field"
              placeholder={t("hosts.search")}
              value={filter.search}
              onChange={(e) => setHostFilter({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearchAction().catch(console.error);
                } else if (e.key === "Escape") {
                  setHostFilter({ search: "" });
                }
              }}
            />
          </div>
          <Select
            className="select-inline"
            aria-label={t("hosts.allTags")}
            value={filter.tag ?? ""}
            options={[
              { value: "", label: t("hosts.allTags") },
              ...tags.map((tag) => ({ value: tag.name, label: tag.name })),
            ]}
            onChange={(v) => setHostFilter({ tag: v || null })}
          />
          <Select
            className="select-inline"
            aria-label={t("hosts.sortName")}
            value={filter.sortBy}
            options={[
              { value: "name", label: t("hosts.sortName") },
              { value: "recent", label: t("hosts.sortRecent") },
              { value: "status", label: t("hosts.sortStatus") },
            ]}
            onChange={(v) =>
              setHostFilter({
                sortBy: v as "name" | "recent" | "status",
              })
            }
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              setCreatePrefill(null);
              setCreating(true);
              setEditing(null);
            }}
          >
            <Plus size={14} />
            {t("hosts.newHost")}
          </button>
        </div>

        {(sshTarget || filter.search.trim()) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="muted">{t("hosts.searchHint")}</span>
            {matchedByTarget && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => connectHost(matchedByTarget).catch(console.error)}
              >
                {t("hosts.searchConnect", { target: targetLabel })}
              </button>
            )}
            {sshTarget && !matchedByTarget && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => openCreateFromTarget(sshTarget)}
              >
                {t("hosts.searchSave")} · {targetLabel}
              </button>
            )}
            {filter.search.trim() && filtered.length === 0 && !sshTarget && (
              <span className="muted">{t("hosts.searchNoMatch")}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase tracking-wide muted">
              {t("hosts.groupsTitle")}
            </span>
          </div>
          <div className="side-nav flex-1 overflow-y-auto px-2 pb-3">
            <button
              type="button"
              className={`list-row ${filter.groupId == null ? "is-active" : ""}`}
              onClick={() => setHostFilter({ groupId: null })}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {t("hosts.allGroups")}
              </span>
              <span className="count-badge">{hosts.length}</span>
            </button>
            {groups.map((g, idx) => (
              <button
                key={g.id}
                type="button"
                className={`list-row ${filter.groupId === g.id ? "is-active" : ""}`}
                onClick={() => setHostFilter({ groupId: g.id })}
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    {
                      id: "rename",
                      label: t("hosts.renameGroup"),
                      onClick: async () => {
                        const name = await dialog.prompt(t("hosts.groupNamePrompt"), {
                          title: t("hosts.renameGroup"),
                          defaultValue: g.name,
                        });
                        if (!name?.trim()) return;
                        try {
                          await renameGroup(g.id, name);
                          await reload();
                        } catch (err) {
                          await dialog.alert(String(err));
                        }
                      },
                    },
                    {
                      id: "up",
                      label: t("hosts.moveUp"),
                      disabled: idx === 0,
                      onClick: async () => {
                        await moveGroup(g.id, "up");
                        await reload();
                      },
                    },
                    {
                      id: "down",
                      label: t("hosts.moveDown"),
                      disabled: idx === groups.length - 1,
                      onClick: async () => {
                        await moveGroup(g.id, "down");
                        await reload();
                      },
                    },
                    "sep",
                    {
                      id: "delete",
                      label: t("hosts.deleteGroup"),
                      danger: true,
                      onClick: async () => {
                        if (
                          !(await dialog.confirm(t("hosts.deleteGroupConfirm"), {
                            danger: true,
                          }))
                        )
                          return;
                        await deleteGroup(g.id);
                        if (filter.groupId === g.id) setHostFilter({ groupId: null });
                        await reload();
                      },
                    },
                  ])
                }
              >
                <span className="min-w-0 flex-1 truncate text-left text-sm">{g.name}</span>
                <span className="count-badge">{groupCounts.get(g.id) || 0}</span>
              </button>
            ))}
            <button
              type="button"
              className={`list-row ${filter.groupId === -1 ? "is-active" : ""}`}
              onClick={() => setHostFilter({ groupId: -1 })}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {t("hosts.ungrouped")}
              </span>
              <span className="count-badge">{groupCounts.get("none") || 0}</span>
            </button>
          </div>
          <div className="border-t border-[var(--border)] p-2">
            <button
              type="button"
              className="btn btn-sm w-full"
              onClick={async () => {
                const name = await dialog.prompt(t("hosts.groupNamePrompt"), {
                  title: t("hosts.newGroup"),
                });
                if (!name?.trim()) return;
                try {
                  const id = await createGroup(name);
                  await reload();
                  setHostFilter({ groupId: id });
                } catch (err) {
                  await dialog.alert(String(err));
                }
              }}
            >
              <Plus size={13} />
              {t("hosts.newGroup")}
            </button>
          </div>
        </aside>

        <div className="flex-1 overflow-auto p-5">
          <h2 className="mb-1 text-lg font-semibold">{activeGroupLabel}</h2>
          <p className="mb-4 text-xs muted">
            {t("hosts.hostsCount", { count: filtered.length })}
          </p>
          {filtered.length === 0 ? (
            <div className="empty-state">{t("hosts.empty")}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((host) => (
                <div
                  key={host.id}
                  className="host-card relative overflow-hidden"
                  onContextMenu={(e) =>
                    openContextMenu(e, openMenu, [
                      {
                        id: "connect",
                        label: t("context.connect"),
                        onClick: () => {
                          connectHost(host).catch(console.error);
                        },
                      },
                      {
                        id: "edit",
                        label: t("context.editHost"),
                        onClick: () => {
                          setEditing(host);
                          setCreating(false);
                        },
                      },
                      "sep",
                      {
                        id: "delete",
                        label: t("context.delete"),
                        danger: true,
                        onClick: async () => {
                          if (
                            !(await dialog.confirm(t("context.confirmDelete"), {
                              danger: true,
                            }))
                          )
                            return;
                          await deleteHost(host.id);
                          await reload();
                        },
                      },
                    ])
                  }
                >
                  {host.color ? (
                    <span
                      className="absolute inset-y-0 left-0 w-1"
                      style={{ background: host.color }}
                    />
                  ) : null}
                  <div className="flex items-start gap-3">
                    <div className="host-avatar">
                      <Server size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{host.name || host.host}</div>
                      <div className="truncate text-xs muted">
                        {host.username}@{host.host}:{host.port}
                      </div>
                      {host.remark ? (
                        <div className="mt-1 line-clamp-2 text-xs muted">{host.remark}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {host.group_name && (
                          <span className="chip">{host.group_name}</span>
                        )}
                        {(host.tags || "")
                          .split(",")
                          .filter(Boolean)
                          .map((tag) => (
                            <span key={tag} className="chip chip-accent">
                              {tag}
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => connectHost(host)}
                    >
                      {t("hosts.connect")}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setEditing(host);
                        setCreating(false);
                      }}
                    >
                      {t("hosts.editHost")}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await deleteHost(host.id);
                        await reload();
                      }}
                    >
                      {t("hosts.delete")}
                    </button>
                  </div>
                </div>
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

const HOST_COLORS = [
  { value: "", labelKey: "colorNone" as const },
  { value: "#3b82f6", label: "蓝" },
  { value: "#22c55e", label: "绿" },
  { value: "#f59e0b", label: "橙" },
  { value: "#ef4444", label: "红" },
  { value: "#a855f7", label: "紫" },
  { value: "#06b6d4", label: "青" },
];

function HostFormModal({
  initial,
  prefill,
  groups,
  hosts,
  onClose,
  onSave,
}: {
  initial: HostRow | null;
  prefill?: Partial<HostRow> | null;
  groups: GroupRow[];
  hosts: HostRow[];
  onClose: () => void;
  onSave: (input: HostInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const seed = initial || prefill;
  const [name, setName] = useState(seed?.name || "");
  const [host, setHost] = useState(seed?.host || "");
  const [port, setPort] = useState(seed?.port || 22);
  const [username, setUsername] = useState(seed?.username || "root");
  const [authType, setAuthType] = useState(initial?.auth_type || "password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(
    initial?.private_key_path || "",
  );
  const [passphrase, setPassphrase] = useState("");
  const [groupId, setGroupId] = useState<number | "">(
    initial?.group_id ?? groups[0]?.id ?? "",
  );
  const [tags, setTags] = useState(initial?.tags || "");
  const [color, setColor] = useState(initial?.color || "");
  const [remark, setRemark] = useState(initial?.remark || "");
  const [connectTimeout, setConnectTimeout] = useState(
    initial?.connect_timeout ?? 30,
  );
  const [keepalive, setKeepalive] = useState(initial?.keepalive_interval ?? 60);
  const [terminalType, setTerminalType] = useState(
    initial?.terminal_type || "xterm-256color",
  );
  const [startupCmd, setStartupCmd] = useState(initial?.startup_cmd || "");
  const [remotePath, setRemotePath] = useState(initial?.remote_path || "");
  const [jumpHostId, setJumpHostId] = useState<number | "">(
    initial?.jump_host_id ?? "",
  );
  const [saving, setSaving] = useState(false);

  const jumpOptions = hosts.filter((h) => h.id !== initial?.id);

  const pickKey = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      title: t("hosts.privateKey"),
    });
    if (typeof file === "string") setPrivateKeyPath(file);
  };

  return (
    <div className="overlay flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="modal-card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-base font-semibold">
            {initial ? t("hosts.editHost") : t("hosts.newHost")}
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Section title={t("hosts.sectionBasic")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("hosts.name")} value={name} onChange={setName} />
              <label className="field-label">
                {t("hosts.color")}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {HOST_COLORS.map((c) => (
                    <button
                      key={c.value || "none"}
                      type="button"
                      title={"label" in c ? c.label : t("hosts.colorNone")}
                      className={`h-7 w-7 rounded-[var(--radius-sm)] border ${
                        color === c.value
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                          : "border-[var(--border)]"
                      }`}
                      style={{
                        background: c.value || "var(--bg-elevated)",
                      }}
                      onClick={() => setColor(c.value)}
                    />
                  ))}
                </div>
              </label>
              <Field label={t("hosts.address")} value={host} onChange={setHost} />
              <Field
                label={t("hosts.port")}
                value={String(port)}
                onChange={(v) => setPort(Number(v) || 22)}
              />
              <Field
                label={t("hosts.username")}
                value={username}
                onChange={setUsername}
              />
              <label className="field-label">
                {t("hosts.group")}
                <Select
                  className="w-full"
                  value={groupId === "" ? "" : String(groupId)}
                  options={[
                    { value: "", label: t("hosts.ungrouped") },
                    ...groups.map((g) => ({
                      value: String(g.id),
                      label: g.name,
                    })),
                  ]}
                  onChange={(v) => setGroupId(v ? Number(v) : "")}
                />
              </label>
            </div>
          </Section>

          <Section title={t("hosts.sectionAuth")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="field-label sm:col-span-2">
                {t("hosts.authType")}
                <Select
                  className="w-full"
                  value={authType}
                  options={[
                    { value: "password", label: t("hosts.password") },
                    { value: "privateKey", label: t("hosts.privateKey") },
                  ]}
                  onChange={setAuthType}
                />
              </label>
              {authType === "password" ? (
                <div className="sm:col-span-2">
                  <Field
                    label={t("hosts.password")}
                    value={password}
                    onChange={setPassword}
                    type="password"
                    placeholder={initial?.password_enc ? "••••••••" : ""}
                  />
                </div>
              ) : (
                <>
                  <label className="field-label sm:col-span-2">
                    {t("hosts.privateKey")}
                    <div className="flex gap-2">
                      <input
                        className="field flex-1 font-mono text-xs"
                        value={privateKeyPath}
                        onChange={(e) => setPrivateKeyPath(e.target.value)}
                      />
                      <button type="button" className="btn shrink-0" onClick={pickKey}>
                        {t("hosts.browse")}
                      </button>
                    </div>
                  </label>
                  <div className="sm:col-span-2">
                    <Field
                      label={t("hosts.passphrase")}
                      value={passphrase}
                      onChange={setPassphrase}
                      type="password"
                      placeholder={initial?.passphrase_enc ? "••••••••" : ""}
                    />
                  </div>
                </>
              )}
            </div>
          </Section>

          <Section title={t("hosts.sectionConn")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={t("hosts.connectTimeout")}
                value={String(connectTimeout)}
                onChange={(v) => setConnectTimeout(Number(v) || 30)}
              />
              <Field
                label={t("hosts.keepalive")}
                value={String(keepalive)}
                onChange={(v) => setKeepalive(Number(v) || 0)}
              />
              <label className="field-label">
                {t("hosts.terminalType")}
                <Select
                  className="w-full"
                  value={terminalType}
                  options={[
                    { value: "xterm-256color", label: "xterm-256color" },
                    { value: "xterm", label: "xterm" },
                    { value: "vt100", label: "vt100" },
                  ]}
                  onChange={setTerminalType}
                />
              </label>
              <Field
                label={t("hosts.remotePath")}
                value={remotePath}
                onChange={setRemotePath}
                placeholder="/home"
              />
              <div className="sm:col-span-2">
                <Field
                  label={t("hosts.startupCmd")}
                  value={startupCmd}
                  onChange={setStartupCmd}
                  placeholder="cd /var/log && ls"
                />
              </div>
              <label className="field-label sm:col-span-2">
                {t("hosts.jumpHost")}
                <Select
                  className="w-full"
                  value={jumpHostId === "" ? "" : String(jumpHostId)}
                  options={[
                    { value: "", label: t("hosts.jumpNone") },
                    ...jumpOptions.map((h) => ({
                      value: String(h.id),
                      label: `${h.name || h.host} (${h.username}@${h.host})`,
                    })),
                  ]}
                  onChange={(v) => setJumpHostId(v ? Number(v) : "")}
                />
              </label>
            </div>
          </Section>

          <Section title={t("hosts.sectionMeta")} last>
            <div className="grid grid-cols-1 gap-3">
              <Field
                label={t("hosts.tags")}
                value={tags}
                onChange={setTags}
                placeholder={t("hosts.tagsHint")}
              />
              <label className="field-label">
                {t("hosts.remark")}
                <textarea
                  className="field min-h-[72px] py-2"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                />
              </label>
            </div>
          </Section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button className="btn" onClick={onClose} disabled={saving}>
            {t("hosts.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !host}
            onClick={async () => {
              setSaving(true);
              try {
                let password_enc = initial?.password_enc ?? null;
                if (authType === "password" && password) {
                  password_enc = await api.encryptSecret(password);
                }
                let passphrase_enc = initial?.passphrase_enc ?? null;
                if (authType === "privateKey" && passphrase) {
                  passphrase_enc = await api.encryptSecret(passphrase);
                }
                await onSave({
                  name: name || host,
                  host,
                  port,
                  username,
                  auth_type: authType === "privateKey" ? "privateKey" : "password",
                  password_enc: authType === "password" ? password_enc : null,
                  private_key_path:
                    authType === "privateKey" ? privateKeyPath || null : null,
                  passphrase_enc:
                    authType === "privateKey" ? passphrase_enc : null,
                  group_id: groupId === "" ? null : groupId,
                  tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
                  color: color || null,
                  remark: remark || null,
                  connect_timeout: connectTimeout,
                  keepalive_interval: keepalive,
                  terminal_type: terminalType,
                  startup_cmd: startupCmd || null,
                  remote_path: remotePath || null,
                  jump_host_id: jumpHostId === "" ? null : jumpHostId,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {t("hosts.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  last,
}: {
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "" : "mb-5"}>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide muted">
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
    </label>
  );
}
