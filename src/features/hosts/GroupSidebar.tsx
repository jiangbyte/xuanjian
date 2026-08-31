/**
 * @file 主机分组侧边栏
 * @author Charlie
 * @description 分组列表、右键菜单；新建入口在标题旁。
 */

import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import {
  SectionAsideHeader,
  SectionNavItem,
  sectionAsideClass,
  sectionAsideIconBtnClass,
  sectionAsideListClass,
} from "@/components/SectionSidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createGroup,
  deleteGroup,
  GroupRow,
  moveGroup,
  renameGroup,
} from "@/lib/db";
import { HOST_GROUP_LOCAL, HOST_GROUP_UNGROUPED } from "@/features/hosts/constants";
import { dialogs } from "@/lib/ui/dialogs";

/** 主机分组侧边栏 */
export function GroupSidebar({
  groups,
  groupCounts,
  hostTotal,
  localShellCount,
  groupId,
  onSelectGroup,
  onReload,
}: {
  groups: GroupRow[];
  groupCounts: Map<number | "none", number>;
  hostTotal: number;
  localShellCount: number;
  groupId: number | null | undefined;
  onSelectGroup: (id: number | null | -1 | -2) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();

  const createNewGroup = async () => {
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
  };

  return (
    <aside className={sectionAsideClass}>
      <SectionAsideHeader title={t("hosts.groupsTitle")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={sectionAsideIconBtnClass}
              aria-label={t("hosts.newGroup")}
              onClick={() => createNewGroup()}
            >
              <Plus size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("hosts.newGroup")}</TooltipContent>
        </Tooltip>
      </SectionAsideHeader>
      <div className={sectionAsideListClass}>
        <SectionNavItem
          active={groupId == null}
          label={t("hosts.allGroups")}
          count={hostTotal}
          onClick={() => onSelectGroup(null)}
        />
        <SectionNavItem
          active={groupId === HOST_GROUP_LOCAL}
          label={t("hosts.localShells")}
          count={localShellCount}
          onClick={() => onSelectGroup(HOST_GROUP_LOCAL)}
        />
        {groups.map((g, idx) => (
          <SectionNavItem
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
        <SectionNavItem
          active={groupId === HOST_GROUP_UNGROUPED}
          label={t("hosts.ungrouped")}
          count={groupCounts.get("none") || 0}
          onClick={() => onSelectGroup(HOST_GROUP_UNGROUPED)}
        />
      </div>
    </aside>
  );
}
