/**
 * @file 主机新建 / 编辑表单弹窗
 * @author Charlie
 * @description 主机基础信息、认证、连接与元数据的表单模态框。
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HostInput, HostRow, GroupRow } from "@/lib/db";
import { api } from "@/lib/tauri";
import { Select } from "@/components/Select";
import { HOST_COLORS } from "@/features/hosts/hostColors";

/** 主机新建 / 编辑表单弹窗 */
export function HostFormModal({
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
    <div
      className="overlay flex items-center justify-center p-4"
      onClick={onClose}
    >
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
              <Field
                label={t("hosts.address")}
                value={host}
                onChange={setHost}
              />
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
                      <button
                        type="button"
                        className="btn shrink-0"
                        onClick={pickKey}
                      >
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
                  auth_type:
                    authType === "privateKey" ? "privateKey" : "password",
                  password_enc: authType === "password" ? password_enc : null,
                  private_key_path:
                    authType === "privateKey" ? privateKeyPath || null : null,
                  passphrase_enc:
                    authType === "privateKey" ? passphrase_enc : null,
                  group_id: groupId === "" ? null : groupId,
                  tags: tags
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
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

/** 表单分区标题与内容 */
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

/** 带标签的文本输入字段 */
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
