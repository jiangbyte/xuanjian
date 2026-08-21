import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, LocalShellInfo } from "../../lib/tauri";
import { HostRow, listHosts, touchHostConnected } from "../../lib/db";
import { useUiStore } from "../../stores/ui";
import { useSettingsStore } from "../../stores/settings";
import { useDialog } from "../../components/Dialog";
import { startRecordingForOpenTab } from "../../lib/sessionRecorder";

export function QuickSwitcher() {
  const open = useUiStore((s) => s.switcherOpen);
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const tabs = useUiStore((s) => s.tabs);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const addTab = useUiStore((s) => s.addTab);
  const updateTab = useUiStore((s) => s.updateTab);
  const defaultLocalShell = useSettingsStore((s) => s.defaultLocalShell);
  const { t } = useTranslation();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [shells, setShells] = useState<LocalShellInfo[]>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);

  useEffect(() => {
    if (!open) return;
    api.listLocalShells().then(setShells).catch(console.error);
    listHosts().then(setHosts).catch(console.error);
    setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const filteredHosts = useMemo(
    () =>
      hosts.filter(
        (h) =>
          !q ||
          h.name.toLowerCase().includes(q) ||
          h.host.toLowerCase().includes(q) ||
          (h.tags || "").toLowerCase().includes(q),
      ),
    [hosts, q],
  );
  const filteredTabs = useMemo(
    () => tabs.filter((tab) => !q || tab.title.toLowerCase().includes(q)),
    [tabs, q],
  );
  const filteredShells = useMemo(
    () =>
      shells.filter(
        (s) => !q || s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q),
      ),
    [shells, q],
  );

  if (!open) return null;

  const openLocal = async (shell: LocalShellInfo) => {
    setSwitcherOpen(false);
    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      title: shell.name,
      kind: "local",
      sessionId: null,
      shellId: shell.id,
      status: "connecting",
    });
    navigate("/terminal");
    try {
      const session = await api.localShellOpen(shell.id);
      const recording = startRecordingForOpenTab(tabId, session.id);
      updateTab(tabId, {
        sessionId: session.id,
        status: "open",
        title: session.title,
        shellId: shell.id,
      });
      await recording;
    } catch (e) {
      updateTab(tabId, { status: "error" });
      await dialog.alert(String(e));
    }
  };

  const openHost = async (host: HostRow) => {
    setSwitcherOpen(false);
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
      updateTab(tabId, {
        sessionId: session.id,
        status: "open",
        title: session.title,
      });
      await recording;
      if (host.startup_cmd?.trim()) {
        await api.sessionWrite(session.id, `${host.startup_cmd.trim()}\n`);
      }
    } catch (e) {
      updateTab(tabId, { status: "error" });
      await dialog.alert(String(e));
    }
  };

  return (
    <div
      className="overlay flex items-start justify-center pt-[12vh]"
      onClick={() => setSwitcherOpen(false)}
    >
      <div
        className="modal-card w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("switcher.title")}
          className="switcher-input"
        />
        <div className="max-h-[50vh] overflow-auto px-2 py-2">
          <Section title={t("switcher.localShell")}>
            {filteredShells.map((shell) => {
              const isDefault =
                shell.id === defaultLocalShell ||
                (!defaultLocalShell && shell.isDefault);
              return (
                <button
                  key={shell.id}
                  type="button"
                  className="list-row justify-between"
                  onClick={() => openLocal(shell)}
                >
                  <span className="list-row-title truncate">{shell.name}</span>
                  {isDefault && (
                    <span className="chip chip-accent">{t("switcher.default")}</span>
                  )}
                </button>
              );
            })}
          </Section>
          <Section title={t("switcher.hosts")}>
            {filteredHosts.map((host) => (
              <button
                key={host.id}
                type="button"
                className="list-row list-row-stack"
                onClick={() => openHost(host)}
              >
                <span className="list-row-title truncate">
                  {host.name || host.host}
                </span>
                <span className="list-row-sub truncate">
                  {host.username}@{host.host}
                </span>
              </button>
            ))}
          </Section>
          <Section title={t("switcher.tabs")}>
            {filteredTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="list-row"
                onClick={() => {
                  setActiveTab(tab.id);
                  setSwitcherOpen(false);
                  navigate("/terminal");
                }}
              >
                <span className="list-row-title truncate">{tab.title}</span>
              </button>
            ))}
          </Section>
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
