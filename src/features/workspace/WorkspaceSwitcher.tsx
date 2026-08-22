/**
 * @file 工作空间切换器
 * @author Charlie
 */

import { FolderGit2, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceFormDialog } from "@/features/workspace/WorkspaceFormDialog";
import {
  bindWorkspaceTab,
  createWorkspace,
  listWorkspaces,
  type WorkspaceRow,
} from "@/lib/db/workspaces";
import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "@/lib/workspace/context";
import { useUiStore } from "@/stores/ui";

/** AI 侧栏次级条：单行工作空间选择（仅 SSH） */
export function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const activeTabId = useUiStore((s) => s.activeTabId);
  const tabs = useUiStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(() =>
    getActiveWorkspaceId(),
  );
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const isSsh = activeTab?.kind === "ssh" && activeTab.hostId != null;

  const reload = useCallback(async () => {
    const list = await listWorkspaces();
    setRows(list);
    const stored = getActiveWorkspaceId();
    if (stored && list.some((w) => w.id === stored)) {
      setActiveId(stored);
      return;
    }
    if (activeTab?.hostId != null) {
      const match = list.find((w) => w.host_id === activeTab.hostId);
      if (match) {
        setActiveId(match.id);
        setActiveWorkspaceId(match.id);
      }
    }
  }, [activeTab?.hostId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = rows.find((w) => w.id === activeId) ?? null;
  const hostWorkspaces = rows.filter((w) => w.host_id === activeTab?.hostId);

  const onSelect = async (value: string) => {
    if (value === "__new__") {
      setCreateOpen(true);
      return;
    }
    if (value === "__none__") {
      setActiveId(null);
      setActiveWorkspaceId(null);
      return;
    }
    const id = Number(value);
    if (!Number.isFinite(id)) return;
    setActiveId(id);
    setActiveWorkspaceId(id);
    if (activeTabId) {
      await bindWorkspaceTab(id, activeTabId);
    }
  };

  if (!activeTab || !isSsh) return null;

  const pathHint = active
    ? `${active.local_root} → ${active.remote_root}`
    : t("terminal.workspaceNoneHint");

  return (
    <>
      <div className="flex items-center gap-1.5 border-t border-border/50 bg-muted/15 px-2.5 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0 text-muted-foreground">
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FolderGit2 size={13} />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
            <p className="font-medium">{t("terminal.workspaceHelpTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("terminal.workspaceHelpBody")}
            </p>
          </TooltipContent>
        </Tooltip>

        <span className="shrink-0 text-[10px] text-muted-foreground">
          {t("terminal.workspaceShort")}
        </span>

        <Select
          value={activeId != null ? String(activeId) : "__none__"}
          onValueChange={(v) => void onSelect(v)}
          disabled={busy}
        >
          <SelectTrigger
            className="h-6 min-w-0 flex-1 border-0 bg-transparent px-1 text-[11px] shadow-none focus:ring-0"
            title={pathHint}
          >
            <SelectValue placeholder={t("terminal.workspaceNone")} />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="__none__" className="text-xs text-muted-foreground">
              {t("terminal.workspaceNone")}
            </SelectItem>
            {hostWorkspaces.map((w) => (
              <SelectItem key={w.id} value={String(w.id)} className="text-xs">
                <span className="font-medium">{w.name}</span>
              </SelectItem>
            ))}
            <SelectItem value="__new__" className="text-xs">
              <span className="inline-flex items-center gap-1">
                <Plus size={12} />
                {t("terminal.workspaceCreate")}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {activeTab.hostId != null ? (
        <WorkspaceFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          hostId={activeTab.hostId}
          tabId={activeTabId}
          defaultName={activeTab.title || ""}
          onSubmit={async (input) => {
            setBusy(true);
            try {
              const id = await createWorkspace(input);
              setActiveWorkspaceId(id);
              setActiveId(id);
              await reload();
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </>
  );
}
