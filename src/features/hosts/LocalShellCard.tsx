/**
 * @file 本地 Shell 卡片
 */

import { Cable, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import type { LocalShellInfo } from "@/lib/tauri";

export function LocalShellCard({
  shell,
  isDefault,
  onConnect,
}: {
  shell: LocalShellInfo;
  isDefault?: boolean;
  onConnect: (shell: LocalShellInfo) => void;
}) {
  const { t } = useTranslation();

  const copyPath = async () => {
    try {
      await clipboardWriteText(shell.path);
      toast.success(t("hosts.copied"));
    } catch {
      toast.error(t("hosts.copyFail"));
    }
  };

  const tags = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge
        variant="secondary"
        className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
      >
        {t("hosts.localShellTag")}
      </Badge>
      {isDefault ? (
        <Badge
          variant="outline"
          className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
        >
          {t("switcher.default")}
        </Badge>
      ) : null}
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
      onClick={() => onConnect(shell)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onConnect(shell);
        }
      }}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground">
        <Monitor size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{shell.name}</span>
          <button
            type="button"
            className="max-w-full truncate rounded-sm font-mono text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={t("hosts.copyPath")}
            onClick={(e) => {
              e.stopPropagation();
              void copyPath();
            }}
          >
            {shell.path}
          </button>
        </div>
        {tags}
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
          onClick={() => onConnect(shell)}
        >
          <Cable size={14} />
        </Button>
      </div>
    </div>
  );
}
