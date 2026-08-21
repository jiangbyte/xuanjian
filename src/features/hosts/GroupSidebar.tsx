/**
 * @file 主机分组侧边栏
 * @author Charlie
 * @description 分组列表、右键菜单与新建分组入口。
 */

import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import {
  createGroup,
  deleteGroup,
  moveGroup,
  renameGroup,
  GroupRow,
} from "@/lib/db";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { useDialog } from "@/components/Dialog";

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
  const dialog = useDialog();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
      <div className="px-3 py-3">
        <span className="text-xs font-medium uppercase tracking-wide muted">
          {t("hosts.groupsTitle")}
        </span>
      </div>
      <div className="side-nav flex-1 overflow-y-auto px-2 pb-3">
        <button
          type="button"
          className={`list-row ${groupId == null ? "is-active" : ""}`}
          onClick={() => onSelectGroup(null)}
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            {t("hosts.allGroups")}
          </span>
          <span className="count-badge">{hostTotal}</span>
        </button>
        {groups.map((g, idx) => (
          <button
            key={g.id}
            type="button"
            className={`list-row ${groupId === g.id ? "is-active" : ""}`}
            onClick={() => onSelectGroup(g.id)}
            onContextMenu={(e) =>
              openContextMenu(e, openMenu, [
                {
                  id: "rename",
                  label: t("hosts.renameGroup"),
                  onClick: async () => {
                    const name = await dialog.prompt(
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
                      await dialog.alert(String(err));
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
                      !(await dialog.confirm(t("hosts.deleteGroupConfirm"), {
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
          >
            <span className="min-w-0 flex-1 truncate text-left text-sm">
              {g.name}
            </span>
            <span className="count-badge">{groupCounts.get(g.id) || 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={`list-row ${groupId === -1 ? "is-active" : ""}`}
          onClick={() => onSelectGroup(-1)}
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            {t("hosts.ungrouped")}
          </span>
          <span className="count-badge">{groupCounts.get("none") || 0}</span>
        </button>
      </div>
      <div className="border-t border-[var(--border)] p-2">
        <button
          type="button"
          className="btn btn-sm w-full"
          onClick={async () => {
            const name = await dialog.prompt(t("hosts.groupNamePrompt"), {
              title: t("hosts.newGroup"),
            });
            if (!name?.trim()) return;
            try {
              const id = await createGroup(name);
              await onReload();
              onSelectGroup(id);
            } catch (err) {
              await dialog.alert(String(err));
            }
          }}
        >
          <Plus size={13} />
          {t("hosts.newGroup")}
        </button>
      </div>
    </aside>
  );
}
