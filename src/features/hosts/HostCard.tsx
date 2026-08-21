/**
 * @file 主机卡片
 * @author Charlie
 * @description 单个主机的展示卡片，含连接 / 编辑 / 删除与右键菜单。
 */

import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { deleteHost, HostRow } from "@/lib/db";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { useDialog } from "@/components/Dialog";

/** 单个主机卡片 */
export function HostCard({
  host,
  onConnect,
  onEdit,
  onReload,
}: {
  host: HostRow;
  onConnect: (host: HostRow) => void;
  onEdit: (host: HostRow) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const dialog = useDialog();

  return (
    <div
      className="host-card relative overflow-hidden"
      onContextMenu={(e) =>
        openContextMenu(e, openMenu, [
          {
            id: "connect",
            label: t("context.connect"),
            onClick: () => {
              onConnect(host);
            },
          },
          {
            id: "edit",
            label: t("context.editHost"),
            onClick: () => {
              onEdit(host);
            },
          },
          "sep",
          {
            id: "delete",
            label: t("context.delete"),
            danger: true,
            onClick: async () => {
              if (
                !(await dialog.confirm(t("context.confirmDelete"), {
                  danger: true,
                }))
              )
                return;
              await deleteHost(host.id);
              await onReload();
            },
          },
        ])
      }
    >
      {host.color ? (
        <span
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: host.color }}
        />
      ) : null}
      <div className="flex items-start gap-3">
        <div className="host-avatar">
          <Server size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{host.name || host.host}</div>
          <div className="truncate text-xs muted">
            {host.username}@{host.host}:{host.port}
          </div>
          {host.remark ? (
            <div className="mt-1 line-clamp-2 text-xs muted">{host.remark}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {host.group_name && <span className="chip">{host.group_name}</span>}
            {(host.tags || "")
              .split(",")
              .filter(Boolean)
              .map((tag) => (
                <span key={tag} className="chip chip-accent">
                  {tag}
                </span>
              ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onConnect(host)}
        >
          {t("hosts.connect")}
        </button>
        <button className="btn btn-sm" onClick={() => onEdit(host)}>
          {t("hosts.editHost")}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={async () => {
            await deleteHost(host.id);
            await onReload();
          }}
        >
          {t("hosts.delete")}
        </button>
      </div>
    </div>
  );
}
