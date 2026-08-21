/**
 * @file 列表批量操作条（已选 / 全选 / 清除 / 导出 / 删除）
 * @author Charlie
 * @description 窄侧栏友好：单行 + 图标按钮 + tooltip。
 */

import { CheckCheck, Download, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 常驻批量操作条；未勾选时导出 / 删除禁用 */
export function BatchActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onExport,
  onDelete,
  className,
}: {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onExport: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const hasSelection = selectedCount > 0;
  const allSelected = totalCount > 0 && selectedCount >= totalCount;

  return (
    <div
      className={cn(
        "flex items-center gap-1 border-b border-border bg-muted px-2 py-1.5",
        className,
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs tabular-nums",
          hasSelection
            ? "font-medium text-foreground"
            : "text-muted-foreground",
        )}
      >
        {t("batch.selected", { count: selectedCount })}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={totalCount === 0 || allSelected}
            aria-label={t("batch.selectAll")}
            onClick={onSelectAll}
          >
            <CheckCheck size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("batch.selectAll")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!hasSelection}
            aria-label={t("batch.clear")}
            onClick={onClear}
          >
            <X size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("batch.clear")}</TooltipContent>
      </Tooltip>
      <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!hasSelection}
            aria-label={t("batch.export")}
            onClick={onExport}
          >
            <Download size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("batch.export")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!hasSelection}
            aria-label={t("batch.delete")}
            className={
              hasSelection
                ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                : undefined
            }
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("batch.delete")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
