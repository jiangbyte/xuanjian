import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Monitor, Server, Terminal, X } from "lucide-react";
import { HostRow, listHosts, touchHostConnected } from "../../lib/db";
import type { ScriptRow } from "../../lib/db";
import { api, LocalShellInfo } from "../../lib/tauri";
import { runScriptOnSession } from "../../lib/runScript";
import { useUiStore, type TermTab } from "../../stores/ui";
import { useDialog } from "../../components/Dialog";
import { startRecordingForOpenTab } from "../../lib/sessionRecorder";

type Target =
  | { kind: "tab"; tab: TermTab }
  | { kind: "host"; host: HostRow }
  | { kind: "shell"; shell: LocalShellInfo };

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
  const dialog = useDialog();
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
    dialog.prompt(label, { defaultValue: def });

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
        if (!target.tab.sessionId) throw new Error(t("scripts.needSessionShort"));
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
      await dialog.alert(String(e));
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
    <div className="overlay z-[95] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="modal-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("scripts.pickTarget")}</h3>
            <div className="truncate text-xs muted">{script.name}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-[var(--border)] px-5 py-3">
          <input
            className="field"
            placeholder={t("scripts.pickSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Section title={t("scripts.openTabs")}>
            {filteredTabs.length === 0 ? (
              <div className="text-xs muted">{t("scripts.noOpenTabs")}</div>
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
              <div className="text-xs muted">{t("hosts.empty")}</div>
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
              <div className="text-xs muted">{t("scripts.noShells")}</div>
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

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button className="btn" onClick={onClose} disabled={running}>
            {t("hosts.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={!target || running}
            onClick={() => onConfirm().catch(console.error)}
          >
            {running ? t("scripts.running") : t("scripts.run")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="menu-section">
      <div className="menu-section-title">{title}</div>
      <div className="menu-list">{children}</div>
    </section>
  );
}

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
      className={`list-row ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      <span className="shrink-0 text-[var(--accent)]">{icon}</span>
      <div className="min-w-0 flex-1 text-left">
        <div className="list-row-title truncate">{title}</div>
        <div className="list-row-sub truncate">{sub}</div>
      </div>
    </button>
  );
}
