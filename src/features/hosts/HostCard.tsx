/**
 * @file 主机卡片
 * @author Charlie
 * @description 单个主机的展示卡片，含多选、连接 / 编辑 / 删除与右键菜单。
 */

import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteHost, HostRow } from "@/lib/db";
import { dialogs } from "@/lib/dialogs";
import { selectionCard, selectionCheckboxClass } from "@/lib/selection";
import { cn } from "@/lib/utils";

/** 单个主机卡片 */
export function HostCard({
  host,
  selected,
  onSelectedChange,
  onConnect,
  onEdit,
  onReload,
}: {
  host: HostRow;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onConnect: (host: HostRow) => void;
  onEdit: (host: HostRow) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();

  return (
    <Card
      className={cn(
        "relative overflow-hidden p-4 transition-colors",
        selectionCard(!!selected),
      )}
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
                !(await dialogs.confirm(t("context.confirmDelete"), {
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
        {onSelectedChange ? (
          <Checkbox
            className={cn("mt-1", selected && selectionCheckboxClass)}
            checked={!!selected}
            onCheckedChange={(v) => onSelectedChange(v === true)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Server size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{host.name || host.host}</p>
          <p className="truncate text-sm text-muted-foreground">
            {host.username}@{host.host}:{host.port}
          </p>
          {host.remark ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {host.remark}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {host.group_name && (
              <Badge variant="secondary">{host.group_name}</Badge>
            )}
            {(host.tags || "")
              .split(",")
              .filter(Boolean)
              .map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="xs" onClick={() => onConnect(host)}>
          {t("hosts.connect")}
        </Button>
        <Button size="xs" variant="outline" onClick={() => onEdit(host)}>
          {t("hosts.editHost")}
        </Button>
        <Button
          size="xs"
          variant="destructive"
          onClick={async () => {
            await deleteHost(host.id);
            await onReload();
          }}
        >
          {t("hosts.delete")}
        </Button>
      </div>
    </Card>
  );
}
