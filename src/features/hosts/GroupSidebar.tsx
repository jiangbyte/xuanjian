/**
 * @file 主机分组侧边栏
 * @author Charlie
 * @description 分组列表、右键菜单与新建分组入口。
 */

import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createGroup,
  deleteGroup,
  moveGroup,
  renameGroup,
  GroupRow,
} from "@/lib/db";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { dialogs } from "@/lib/dialogs";

/** 主机分组侧边栏 */
export function GroupSidebar({
  groups,
  groupCounts,
  hostTotal,
  groupId,
  onSelectGroup,
  onReload,
}: {
  groups: GroupRow[];
  groupCounts: Map<number | "none", number>;
  hostTotal: number;
  groupId: number | null | undefined;
  onSelectGroup: (id: number | null | -1) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-background">
      <div className="px-3 py-3">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {t("hosts.groupsTitle")}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        <SidebarNavItem
          active={groupId == null}
          label={t("hosts.allGroups")}
          count={hostTotal}
          onClick={() => onSelectGroup(null)}
        />
        {groups.map((g, idx) => (
          <SidebarNavItem
            key={g.id}
            active={groupId === g.id}
            label={g.name}
            count={groupCounts.get(g.id) || 0}
            onClick={() => onSelectGroup(g.id)}
            onContextMenu={(e) =>
              openContextMenu(e, openMenu, [
                {
                  id: "rename",
                  label: t("hosts.renameGroup"),
                  onClick: async () => {
                    const name = await dialogs.prompt(
                      t("hosts.groupNamePrompt"),
                      {
                        title: t("hosts.renameGroup"),
                        defaultValue: g.name,
                      },
                    );
                    if (!name?.trim()) return;
                    try {
                      await renameGroup(g.id, name);
                      await onReload();
                    } catch (err) {
                      await dialogs.alert(String(err));
                    }
                  },
                },
                {
                  id: "up",
                  label: t("hosts.moveUp"),
                  disabled: idx === 0,
                  onClick: async () => {
                    await moveGroup(g.id, "up");
                    await onReload();
                  },
                },
                {
                  id: "down",
                  label: t("hosts.moveDown"),
                  disabled: idx === groups.length - 1,
                  onClick: async () => {
                    await moveGroup(g.id, "down");
                    await onReload();
                  },
                },
                "sep",
                {
                  id: "delete",
                  label: t("hosts.deleteGroup"),
                  danger: true,
                  onClick: async () => {
                    if (
                      !(await dialogs.confirm(t("hosts.deleteGroupConfirm"), {
                        danger: true,
                      }))
                    )
                      return;
                    await deleteGroup(g.id);
                    if (groupId === g.id) onSelectGroup(null);
                    await onReload();
                  },
                },
              ])
            }
          />
        ))}
        <SidebarNavItem
          active={groupId === -1}
          label={t("hosts.ungrouped")}
          count={groupCounts.get("none") || 0}
          onClick={() => onSelectGroup(-1)}
        />
      </div>
      <div className="border-t border-border p-2">
        <Button
          size="xs"
          variant="outline"
          className="w-full"
          onClick={async () => {
            const name = await dialogs.prompt(t("hosts.groupNamePrompt"), {
              title: t("hosts.newGroup"),
            });
            if (!name?.trim()) return;
            try {
              const id = await createGroup(name);
              await onReload();
              onSelectGroup(id);
            } catch (err) {
              await dialogs.alert(String(err));
            }
          }}
        >
          <Plus size={13} />
          {t("hosts.newGroup")}
        </Button>
      </div>
    </aside>
  );
}

function SidebarNavItem({
  active,
  label,
  count,
  onClick,
  onContextMenu,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-muted",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="truncate">{label}</span>
      <Badge variant="secondary" className="shrink-0">
        {count}
      </Badge>
    </button>
  );
}
