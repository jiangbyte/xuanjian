/**
 * @file 快速切换器（Quick Switcher）
 * @author Charlie
 * @description 全局快捷面板：搜索并打开本地 Shell、已保存主机或已有标签页。
 * 打开时拉取本地 Shell 列表与主机列表，按关键字过滤。
 * 连接成功后会启动会话录制并导航到 /terminal。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dialogs } from "@/lib/dialogs";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, LocalShellInfo } from "@/lib/tauri";
import { HostRow, listHosts, touchHostConnected } from "@/lib/db";
import { useUiStore } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
import { startRecordingForOpenTab } from "@/lib/sessionRecorder";
import { cn } from "@/lib/utils";

const rowClass =
  "flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent";

/**
 * 快速切换器浮层：本地 Shell / 主机 / 标签三分区列表。
 */
export function QuickSwitcher() {
  const open = useUiStore((s) => s.switcherOpen);
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const tabs = useUiStore((s) => s.tabs);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const addTab = useUiStore((s) => s.addTab);
  const updateTab = useUiStore((s) => s.updateTab);
  const defaultLocalShell = useSettingsStore((s) => s.defaultLocalShell);
  const { t } = useTranslation();
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
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.path.toLowerCase().includes(q),
      ),
    [shells, q],
  );

  /** 打开本地 Shell 会话并切到终端页 */
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
      await dialogs.alert(String(e));
    }
  };

  /** SSH 连接主机并可选写入启动命令 */
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
    } catch (e) {
      updateTab(tabId, { status: "error" });
      await dialogs.alert(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setSwitcherOpen(false)}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">{t("switcher.title")}</DialogTitle>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("switcher.title")}
          className="h-auto rounded-none border-0 border-b border-border px-4 py-3.5 text-[15px] shadow-none focus-visible:ring-0"
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
                  className={cn(rowClass, "justify-between")}
                  onClick={() => openLocal(shell)}
                >
                  <span className="truncate text-sm font-semibold">
                    {shell.name}
                  </span>
                  {isDefault && (
                    <Badge variant="secondary">{t("switcher.default")}</Badge>
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
                className={rowClass}
                onClick={() => openHost(host)}
              >
                <div className="min-w-0 w-full space-y-0.5">
                  <div className="truncate text-sm font-semibold">
                    {host.name || host.host}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {host.username}@{host.host}
                  </div>
                </div>
              </button>
            ))}
          </Section>
          <Section title={t("switcher.tabs")}>
            {filteredTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={rowClass}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSwitcherOpen(false);
                  navigate("/terminal");
                }}
              >
                <span className="truncate text-sm font-semibold">
                  {tab.title}
                </span>
              </button>
            ))}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 切换器内部分组标题 + 列表 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-2 space-y-1">
      <div className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
