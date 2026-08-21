import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Clock3,
  Container,
  FolderOpen,
  ListTodo,
  Network,
  Zap,
} from "lucide-react";
import { TerminalSidePanel } from "./TerminalSidePanel";
import { ScriptsPane } from "./panes/ScriptsPane";
import { HistoryPane } from "./panes/HistoryPane";
import { OverviewPane } from "./panes/OverviewPane";
import { ProcessesPane } from "./panes/ProcessesPane";
import { PortsPane } from "./panes/PortsPane";
import { DockerPane } from "./panes/DockerPane";

export type LeftTabId =
  | "files"
  | "scripts"
  | "history"
  | "overview"
  | "processes"
  | "ports"
  | "docker";

export function TerminalLeftPanel({
  sessionId,
  kind,
  hostId,
  shellId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  hostId?: number | null;
  shellId?: string | null;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LeftTabId>("files");

  const tabs = useMemo(
    () =>
      [
        { id: "files" as const, icon: FolderOpen, label: t("termTab.files") },
        { id: "scripts" as const, icon: Zap, label: t("termTab.scripts") },
        { id: "history" as const, icon: Clock3, label: t("termTab.history") },
        { id: "overview" as const, icon: Activity, label: t("termTab.overview") },
        { id: "processes" as const, icon: ListTodo, label: t("termTab.processes") },
        { id: "ports" as const, icon: Network, label: t("termTab.ports") },
        { id: "docker" as const, icon: Container, label: t("termTab.docker") },
      ] as const,
    [t],
  );

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <nav className="term-rail" aria-label={t("termTab.rail")}>
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`term-rail-btn tip ${active ? "is-active" : ""}`}
              data-tip={item.label}
              aria-label={item.label}
              onClick={() => setTab(item.id)}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-hidden">
        {tab === "files" && (
          <TerminalSidePanel sessionId={sessionId} kind={kind} hostId={hostId} />
        )}
        {tab === "scripts" && <ScriptsPane sessionId={sessionId} />}
        {tab === "history" && <HistoryPane sessionId={sessionId} />}
        {tab === "overview" && (
          <OverviewPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
        {tab === "processes" && (
          <ProcessesPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
        {tab === "ports" && (
          <PortsPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
        {tab === "docker" && (
          <DockerPane sessionId={sessionId} kind={kind} shellId={shellId} />
        )}
      </div>
    </div>
  );
}
