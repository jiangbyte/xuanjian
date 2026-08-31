/**
 * @file 主机卡片
 * @author Charlie
 * @description 勾选、名称与连接串、标签；悬停显示连接/编辑，删除走右键或批量栏。
 */

import { Cable, Pencil, Server, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteHost, HostRow } from "@/lib/db";
import { dialogs } from "@/lib/ui/dialogs";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import { selectionCheckboxClass, selectionRow } from "@/lib/core/selection";
import { cn } from "@/lib/utils";

/** 单个主机项 */
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
  const tags = (host.tags || "").split(",").filter(Boolean);
  const displayName = host.name || host.host;
  const address = `${host.username}@${host.host}:${host.port}`;

  const copyText = async (text: string) => {
    try {
      await clipboardWriteText(text);
      toast.success(t("hosts.copied"));
    } catch {
      toast.error(t("hosts.copyFail"));
    }
  };

  const remove = async () => {
    if (
      !(await dialogs.confirm(t("context.confirmDelete"), {
        danger: true,
      }))
    )
      return;
    await deleteHost(host.id);
    await onReload();
  };

  const menuItems = [
    {
      id: "connect",
      label: t("context.connect"),
      onClick: () => onConnect(host),
    },
    {
      id: "edit",
      label: t("context.editHost"),
      onClick: () => onEdit(host),
    },
    "sep" as const,
    {
      id: "copy-name",
      label: t("hosts.copyName"),
      onClick: () => {
        void copyText(displayName);
      },
    },
    {
      id: "copy-address",
      label: t("hosts.copyAddress"),
      onClick: () => {
        void copyText(address);
      },
    },
    "sep" as const,
    {
      id: "delete",
      label: t("context.delete"),
      danger: true,
      onClick: () => {
        void remove();
      },
    },
  ];

  const metaRow =
    host.remark || host.group_name || tags.length > 0 ? (
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
        {host.remark ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {host.remark}
          </span>
        ) : null}
        {host.group_name ? (
          <Badge
            variant="secondary"
            className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
          >
            {host.group_name}
          </Badge>
        ) : null}
        {tags.slice(0, 3).map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
          >
            {tag}
          </Badge>
        ))}
        {tags.length > 3 ? (
          <span className="text-[10px] text-muted-foreground">
            +{tags.length - 3}
          </span>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        selectionRow(!!selected),
      )}
      onClick={() => onConnect(host)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onConnect(host);
        }
      }}
      onContextMenu={(e) => openContextMenu(e, openMenu, menuItems)}
    >
      {host.color ? (
        <span
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ background: host.color }}
          aria-hidden
        />
      ) : null}

      {onSelectedChange ? (
        <Checkbox
          className={cn("shrink-0", selected && selectionCheckboxClass)}
          checked={!!selected}
          onCheckedChange={(v) => onSelectedChange(v === true)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}

      <div className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground">
        <Server size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            className="max-w-full truncate rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={t("hosts.copyName")}
            onClick={(e) => {
              e.stopPropagation();
              void copyText(displayName);
            }}
          >
            {displayName}
          </button>
          <button
            type="button"
            className="max-w-full truncate rounded-sm font-mono text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={t("hosts.copyAddress")}
            onClick={(e) => {
              e.stopPropagation();
              void copyText(address);
            }}
          >
            {address}
          </button>
        </div>
        {metaRow}
      </div>

      <div
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-7"
          title={t("hosts.connect")}
          aria-label={t("hosts.connect")}
          onClick={() => onConnect(host)}
        >
          <Cable size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-7"
          title={t("hosts.editHost")}
          aria-label={t("hosts.editHost")}
          onClick={() => onEdit(host)}
        >
          <Pencil size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          title={t("hosts.delete")}
          aria-label={t("hosts.delete")}
          onClick={() => void remove()}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}
