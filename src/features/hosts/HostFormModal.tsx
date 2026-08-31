/**
 * @file 主机新建 / 编辑表单弹窗
 * @author Charlie
 * @description 主机基础信息、认证、连接与元数据的表单模态框。
 */

import { Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { HOST_COLORS } from "@/features/hosts/hostColors";
import { LocalShellList } from "@/features/hosts/LocalShellList";
import { GroupRow, HostInput, HostRow } from "@/lib/db";
import { sshConnectWithTrust } from "@/lib/session/connect";
import { api, type LocalShellInfo } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const NONE = "none";

/** 主机新建 / 编辑表单弹窗 */
export function HostFormModal({
  initial,
  prefill,
  groups,
  hosts,
  onClose,
  onSave,
  onConnectShell,
}: {
  initial: HostRow | null;
  prefill?: Partial<HostRow> | null;
  groups: GroupRow[];
  hosts: HostRow[];
  onClose: () => void;
  onSave: (input: HostInput) => Promise<void>;
  onConnectShell?: (shell: LocalShellInfo) => void;
}) {
  const { t } = useTranslation();
  const isCreate = !initial;
  const [tab, setTab] = useState<"remote" | "local">("remote");
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
  const [proxyType, setProxyType] = useState(initial?.proxy_type || NONE);
  const [proxyHost, setProxyHost] = useState(initial?.proxy_host || "");
  const [proxyPort, setProxyPort] = useState(initial?.proxy_port ?? 1080);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const jumpOptions = hosts.filter((h) => h.id !== initial?.id);

  const pickKey = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      title: t("hosts.privateKey"),
    });
    if (typeof file === "string") setPrivateKeyPath(file);
  };

  const toNumber = (v: string | number, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const testConnect = async () => {
    if (!host.trim()) {
      toast.error(t("hosts.testConnectNeedHost"));
      return;
    }
    let passwordValue: string | null = null;
    let passphraseValue: string | null = null;
    if (authType === "password") {
      passwordValue = password.trim() || initial?.password_enc || null;
      if (!passwordValue) {
        toast.error(t("hosts.testConnectNeedAuth"));
        return;
      }
    } else {
      if (!privateKeyPath.trim()) {
        toast.error(t("hosts.testConnectNeedAuth"));
        return;
      }
      passphraseValue = passphrase.trim() || initial?.passphrase_enc || null;
    }
    setTesting(true);
    try {
      const session = await sshConnectWithTrust({
        host: host.trim(),
        port,
        username: username.trim() || "root",
        authType: authType === "privateKey" ? "privateKey" : "password",
        password: authType === "password" ? passwordValue : null,
        privateKeyPath:
          authType === "privateKey" ? privateKeyPath.trim() || null : null,
        passphrase: authType === "privateKey" ? passphraseValue : null,
        title: name || host,
        terminalType,
        proxyType: proxyType === NONE ? null : proxyType,
        proxyHost: proxyType === NONE ? null : proxyHost.trim() || null,
        proxyPort: proxyType === NONE ? null : proxyPort,
        jumpHostId: jumpHostId === "" ? null : jumpHostId,
      });
      await api.sessionClose(session.id);
      toast.success(t("hosts.testConnectOk"));
    } catch (e) {
      toast.error(`${t("hosts.testConnectFail")}: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(720px,88vh)] max-h-[88vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {initial ? t("hosts.editHost") : t("hosts.newHost")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isCreate ? (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "remote" | "local")}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <TabsList className="w-full shrink-0">
              <TabsTrigger value="remote" className="flex-1">
                {t("hosts.tabRemote")}
              </TabsTrigger>
              <TabsTrigger value="local" className="flex-1">
                {t("hosts.tabLocalShell")}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="remote"
              className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
            >
              <HostFormBody
                t={t}
                name={name}
                setName={setName}
                host={host}
                setHost={setHost}
                port={port}
                setPort={setPort}
                username={username}
                setUsername={setUsername}
                authType={authType}
                setAuthType={setAuthType}
                password={password}
                setPassword={setPassword}
                privateKeyPath={privateKeyPath}
                setPrivateKeyPath={setPrivateKeyPath}
                passphrase={passphrase}
                setPassphrase={setPassphrase}
                groupId={groupId}
                setGroupId={setGroupId}
                groups={groups}
                tags={tags}
                setTags={setTags}
                color={color}
                setColor={setColor}
                remark={remark}
                setRemark={setRemark}
                connectTimeout={connectTimeout}
                setConnectTimeout={setConnectTimeout}
                keepalive={keepalive}
                setKeepalive={setKeepalive}
                terminalType={terminalType}
                setTerminalType={setTerminalType}
                startupCmd={startupCmd}
                setStartupCmd={setStartupCmd}
                remotePath={remotePath}
                setRemotePath={setRemotePath}
                jumpHostId={jumpHostId}
                setJumpHostId={setJumpHostId}
                jumpOptions={jumpOptions}
                proxyType={proxyType}
                setProxyType={setProxyType}
                proxyHost={proxyHost}
                setProxyHost={setProxyHost}
                proxyPort={proxyPort}
                setProxyPort={setProxyPort}
                initial={initial}
                pickKey={pickKey}
                toNumber={toNumber}
              />
            </TabsContent>
            <TabsContent
              value="local"
              className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <LocalShellList
                className="h-full"
                onConnect={(shell) => {
                  onConnectShell?.(shell);
                  onClose();
                }}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
          <HostFormBody
            t={t}
            name={name}
            setName={setName}
            host={host}
            setHost={setHost}
            port={port}
            setPort={setPort}
            username={username}
            setUsername={setUsername}
            authType={authType}
            setAuthType={setAuthType}
            password={password}
            setPassword={setPassword}
            privateKeyPath={privateKeyPath}
            setPrivateKeyPath={setPrivateKeyPath}
            passphrase={passphrase}
            setPassphrase={setPassphrase}
            groupId={groupId}
            setGroupId={setGroupId}
            groups={groups}
            tags={tags}
            setTags={setTags}
            color={color}
            setColor={setColor}
            remark={remark}
            setRemark={setRemark}
            connectTimeout={connectTimeout}
            setConnectTimeout={setConnectTimeout}
            keepalive={keepalive}
            setKeepalive={setKeepalive}
            terminalType={terminalType}
            setTerminalType={setTerminalType}
            startupCmd={startupCmd}
            setStartupCmd={setStartupCmd}
            remotePath={remotePath}
            setRemotePath={setRemotePath}
            jumpHostId={jumpHostId}
            setJumpHostId={setJumpHostId}
            jumpOptions={jumpOptions}
            proxyType={proxyType}
            setProxyType={setProxyType}
            proxyHost={proxyHost}
            setProxyHost={setProxyHost}
            proxyPort={proxyPort}
            setProxyPort={setProxyPort}
            initial={initial}
            pickKey={pickKey}
            toNumber={toNumber}
          />
          </div>
        )}
        </div>

        {isCreate && tab === "local" ? (
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={onClose}>
              {t("hosts.cancel")}
            </Button>
          </DialogFooter>
        ) : null}

        {(!isCreate || tab === "remote") && (
        <DialogFooter className="shrink-0 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="sm:mr-auto"
            disabled={saving || testing || !host.trim()}
            onClick={() => void testConnect()}
          >
            {testing ? <Loader2 className="animate-spin" size={14} /> : null}
            {t("hosts.testConnect")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving || testing}
            >
              {t("hosts.cancel")}
            </Button>
            <Button
              disabled={saving || testing || !host}
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
                    proxy_type: proxyType === NONE ? null : proxyType,
                    proxy_host:
                      proxyType === NONE ? null : proxyHost.trim() || null,
                    proxy_port: proxyType === NONE ? null : proxyPort,
                  });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              {t("hosts.save")}
            </Button>
          </div>
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

type HostFormBodyProps = {
  t: (key: string) => string;
  name: string;
  setName: (v: string) => void;
  host: string;
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
  username: string;
  setUsername: (v: string) => void;
  authType: string;
  setAuthType: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  privateKeyPath: string;
  setPrivateKeyPath: (v: string) => void;
  passphrase: string;
  setPassphrase: (v: string) => void;
  groupId: number | "";
  setGroupId: (v: number | "") => void;
  groups: GroupRow[];
  tags: string;
  setTags: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  remark: string;
  setRemark: (v: string) => void;
  connectTimeout: number;
  setConnectTimeout: (v: number) => void;
  keepalive: number;
  setKeepalive: (v: number) => void;
  terminalType: string;
  setTerminalType: (v: string) => void;
  startupCmd: string;
  setStartupCmd: (v: string) => void;
  remotePath: string;
  setRemotePath: (v: string) => void;
  jumpHostId: number | "";
  setJumpHostId: (v: number | "") => void;
  jumpOptions: HostRow[];
  proxyType: string;
  setProxyType: (v: string) => void;
  proxyHost: string;
  setProxyHost: (v: string) => void;
  proxyPort: number;
  setProxyPort: (v: number) => void;
  initial: HostRow | null;
  pickKey: () => Promise<void>;
  toNumber: (v: string | number, fallback: number) => number;
};

function HostFormBody(props: HostFormBodyProps) {
  const {
    t,
    name,
    setName,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    authType,
    setAuthType,
    password,
    setPassword,
    privateKeyPath,
    setPrivateKeyPath,
    passphrase,
    setPassphrase,
    groupId,
    setGroupId,
    groups,
    tags,
    setTags,
    color,
    setColor,
    remark,
    setRemark,
    connectTimeout,
    setConnectTimeout,
    keepalive,
    setKeepalive,
    terminalType,
    setTerminalType,
    startupCmd,
    setStartupCmd,
    remotePath,
    setRemotePath,
    jumpHostId,
    setJumpHostId,
    jumpOptions,
    proxyType,
    setProxyType,
    proxyHost,
    setProxyHost,
    proxyPort,
    setProxyPort,
    initial,
    pickKey,
    toNumber,
  } = props;

  return (
    <div className="pr-1">
      <Section title={t("hosts.sectionBasic")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("hosts.name")}>
            <Input value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </Field>
          <div>
            <Label className="mb-1.5 block">{t("hosts.color")}</Label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {HOST_COLORS.map((c) => (
                <button
                  key={c.value || "none"}
                  type="button"
                  title={"label" in c ? c.label : t("hosts.colorNone")}
                  className={cn(
                    "h-7 w-7 rounded-md border",
                    color === c.value
                      ? "border-primary ring-1 ring-primary"
                      : "border-border",
                    !c.value && "bg-muted",
                  )}
                  style={c.value ? { background: c.value } : undefined}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </div>
          </div>
          <Field label={t("hosts.address")}>
            <Input value={host} onChange={(e) => setHost(e.currentTarget.value)} />
          </Field>
          <Field label={t("hosts.port")}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(toNumber(e.currentTarget.value, 22))}
            />
          </Field>
          <Field label={t("hosts.username")}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
          </Field>
          <Field label={t("hosts.group")}>
            <Select
              value={groupId === "" ? NONE : String(groupId)}
              onValueChange={(v) => setGroupId(v === NONE ? "" : Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("hosts.ungrouped")}</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title={t("hosts.sectionAuth")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("hosts.authType")} className="sm:col-span-2">
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">{t("hosts.password")}</SelectItem>
                <SelectItem value="privateKey">
                  {t("hosts.privateKey")}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {authType === "password" ? (
            <Field label={t("hosts.password")} className="sm:col-span-2">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                placeholder={initial?.password_enc ? "••••••••" : ""}
              />
            </Field>
          ) : (
            <>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block">{t("hosts.privateKey")}</Label>
                <div className="flex flex-nowrap items-end gap-2">
                  <Input
                    className="flex-1 font-mono text-xs"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.currentTarget.value)}
                  />
                  <Button variant="outline" onClick={() => void pickKey()}>
                    {t("hosts.browse")}
                  </Button>
                </div>
              </div>
              <Field label={t("hosts.passphrase")} className="sm:col-span-2">
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.currentTarget.value)}
                  placeholder={initial?.passphrase_enc ? "••••••••" : ""}
                />
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section title={t("hosts.sectionConn")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("hosts.connectTimeout")}>
            <Input
              type="number"
              min={1}
              value={connectTimeout}
              onChange={(e) =>
                setConnectTimeout(toNumber(e.currentTarget.value, 30))
              }
            />
          </Field>
          <Field label={t("hosts.keepalive")}>
            <Input
              type="number"
              min={0}
              value={keepalive}
              onChange={(e) => setKeepalive(toNumber(e.currentTarget.value, 0))}
            />
          </Field>
          <Field label={t("hosts.terminalType")}>
            <Select value={terminalType} onValueChange={setTerminalType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xterm-256color">xterm-256color</SelectItem>
                <SelectItem value="xterm">xterm</SelectItem>
                <SelectItem value="vt100">vt100</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("hosts.remotePath")}>
            <Input
              value={remotePath}
              onChange={(e) => setRemotePath(e.currentTarget.value)}
              placeholder="/home"
            />
          </Field>
          <Field label={t("hosts.startupCmd")} className="sm:col-span-2">
            <Input
              value={startupCmd}
              onChange={(e) => setStartupCmd(e.currentTarget.value)}
              placeholder="cd /var/log && ls"
            />
          </Field>
          <Field label={t("hosts.jumpHost")} className="sm:col-span-2">
            <Select
              value={jumpHostId === "" ? NONE : String(jumpHostId)}
              onValueChange={(v) => setJumpHostId(v === NONE ? "" : Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("hosts.jumpNone")}</SelectItem>
                {jumpOptions.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>
                    {`${h.name || h.host} (${h.username}@${h.host})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("hosts.proxyType")}>
            <Select value={proxyType} onValueChange={setProxyType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("hosts.proxyNone")}</SelectItem>
                <SelectItem value="socks5">SOCKS5</SelectItem>
                <SelectItem value="http">HTTP CONNECT</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("hosts.proxyHost")}>
            <Input
              value={proxyHost}
              disabled={proxyType === NONE}
              onChange={(e) => setProxyHost(e.currentTarget.value)}
              placeholder="127.0.0.1"
            />
          </Field>
          <Field label={t("hosts.proxyPort")}>
            <Input
              type="number"
              min={1}
              max={65535}
              disabled={proxyType === NONE}
              value={proxyPort}
              onChange={(e) => setProxyPort(toNumber(e.currentTarget.value, 1080))}
            />
          </Field>
        </div>
      </Section>

      <Section title={t("hosts.sectionMeta")} last>
        <div className="grid grid-cols-1 gap-3">
          <Field label={t("hosts.tags")}>
            <Input
              value={tags}
              onChange={(e) => setTags(e.currentTarget.value)}
              placeholder={t("hosts.tagsHint")}
            />
          </Field>
          <Field label={t("hosts.remark")}>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.currentTarget.value)}
              rows={3}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
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
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  );
}
