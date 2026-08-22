/**
 * @file 脚本运行目标选择弹窗
 * @author Charlie
 * @description 选择已开标签、SSH 主机或本地 Shell 作为脚本执行目标；
 * 必要时新建会话并启动录制后再投递脚本。
 */

import { Loader2, Monitor, Server, Terminal } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ScriptRow } from "@/lib/db";
import { HostRow, listHosts, touchHostConnected } from "@/lib/db";
import { dialogs } from "@/lib/ui/dialogs";
import { runScriptOnSession } from "@/lib/session/runScript";
import { startRecordingForOpenTab } from "@/lib/session/recorder";
import { api, LocalShellInfo } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { type TermTab, useUiStore } from "@/stores/ui";

type Target =
  | { kind: "tab"; tab: TermTab }
  | { kind: "host"; host: HostRow }
  | { kind: "shell"; shell: LocalShellInfo };

/** 选择脚本运行目标并执行 */
export function RunScriptTargetModal({
  script,
  preferSessionId,
  onClose,
}: {
  script: ScriptRow;
  preferSessionId?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const addTab = useUiStore((s) => s.addTab);
  const updateTab = useUiStore((s) => s.updateTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [shells, setShells] = useState<LocalShellInfo[]>([]);
  const [q, setQ] = useState("");
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  const openTabs = useMemo(
    () => tabs.filter((tab) => tab.status === "open" && tab.sessionId),
    [tabs],
  );

  useEffect(() => {
    listHosts().then(setHosts).catch(console.error);
    api.listLocalShells().then(setShells).catch(console.error);
  }, []);

  useEffect(() => {
    if (preferSessionId) {
      const tab = openTabs.find((x) => x.sessionId === preferSessionId);
      if (tab) {
        setTarget({ kind: "tab", tab });
        return;
      }
    }
    const active = openTabs.find((x) => x.id === activeTabId) || openTabs[0];
    if (active) setTarget({ kind: "tab", tab: active });
  }, [preferSessionId, openTabs, activeTabId]);

  const filteredHosts = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(query) ||
        h.host.toLowerCase().includes(query) ||
        h.username.toLowerCase().includes(query),
    );
  }, [hosts, q]);

  const filteredTabs = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return openTabs;
    return openTabs.filter((tab) => tab.title.toLowerCase().includes(query));
  }, [openTabs, q]);

  const filteredShells = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return shells;
    return shells.filter((s) => s.name.toLowerCase().includes(query));
  }, [shells, q]);

  const promptVar = (label: string, def?: string) =>
    dialogs.prompt(label, { defaultValue: def });

  const runOnSession = async (sessionId: string, tabId?: string) => {
    await runScriptOnSession(sessionId, script, promptVar);
    if (tabId) setActiveTab(tabId);
    navigate("/terminal");
    onClose();
  };

  const onConfirm = async () => {
    if (!target || running) return;
    setRunning(true);
    try {
      if (target.kind === "tab") {
        if (!target.tab.sessionId)
          throw new Error(t("scripts.needSessionShort"));
        await runOnSession(target.tab.sessionId, target.tab.id);
        return;
      }

      if (target.kind === "shell") {
        const tabId = crypto.randomUUID();
        addTab({
          id: tabId,
          title: target.shell.name,
          kind: "local",
          sessionId: null,
          shellId: target.shell.id,
          status: "connecting",
        });
        navigate("/terminal");
        const session = await api.localShellOpen(target.shell.id);
        const recording = startRecordingForOpenTab(tabId, session.id);
        updateTab(tabId, {
          sessionId: session.id,
          status: "open",
          title: session.title,
          shellId: target.shell.id,
        });
        await recording;
        await runScriptOnSession(session.id, script, promptVar);
        setActiveTab(tabId);
        onClose();
        return;
      }

      const host = target.host;
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
      await runScriptOnSession(session.id, script, promptVar);
      setActiveTab(tabId);
      onClose();
    } catch (e) {
      await dialogs.alert(String(e));
    } finally {
      setRunning(false);
    }
  };

  const selectedKey =
    target?.kind === "tab"
      ? `tab:${target.tab.id}`
      : target?.kind === "host"
        ? `host:${target.host.id}`
        : target?.kind === "shell"
          ? `shell:${target.shell.id}`
          : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("scripts.pickTarget")}</DialogTitle>
          <DialogDescription className="truncate">
            {script.name}
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder={t("scripts.pickSearch")}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          autoFocus
        />

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          <Section title={t("scripts.openTabs")}>
            {filteredTabs.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t("scripts.noOpenTabs")}
              </div>
            ) : (
              filteredTabs.map((tab) => (
                <TargetRow
                  key={tab.id}
                  active={selectedKey === `tab:${tab.id}`}
                  icon={<Terminal size={14} />}
                  title={tab.title}
                  sub={
                    tab.kind === "ssh"
                      ? t("scripts.tabSsh")
                      : t("scripts.tabLocal")
                  }
                  onClick={() => setTarget({ kind: "tab", tab })}
                />
              ))
            )}
          </Section>

          <Section title={t("scripts.hosts")}>
            {filteredHosts.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t("hosts.empty")}
              </div>
            ) : (
              filteredHosts.map((host) => (
                <TargetRow
                  key={host.id}
                  active={selectedKey === `host:${host.id}`}
                  icon={<Server size={14} />}
                  title={host.name || host.host}
                  sub={`${host.username}@${host.host}:${host.port}`}
                  onClick={() => setTarget({ kind: "host", host })}
                />
              ))
            )}
          </Section>

          <Section title={t("scripts.localShells")}>
            {filteredShells.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t("scripts.noShells")}
              </div>
            ) : (
              filteredShells.map((shell) => (
                <TargetRow
                  key={shell.id}
                  active={selectedKey === `shell:${shell.id}`}
                  icon={<Monitor size={14} />}
                  title={shell.name}
                  sub={shell.path}
                  onClick={() => setTarget({ kind: "shell", shell })}
                />
              ))
            )}
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>
            {t("hosts.cancel")}
          </Button>
          <Button
            disabled={!target || running}
            onClick={() => onConfirm().catch(console.error)}
          >
            {running ? <Loader2 className="animate-spin" /> : null}
            {running ? t("scripts.running") : t("scripts.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 目标列表分组标题 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

/** 可选运行目标的一行 */
function TargetRow({
  active,
  icon,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
      )}
      onClick={onClick}
    >
      <span className="shrink-0 text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}
