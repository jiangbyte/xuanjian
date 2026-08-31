/**
 * @file 本地 Shell 选择列表（新建连接弹窗等）
 */

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, type LocalShellInfo } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";

const rowClass =
  "flex w-full items-center gap-2 rounded-md border border-transparent p-2.5 text-left hover:border-border hover:bg-accent";

export function LocalShellList({
  onConnect,
  className,
}: {
  onConnect: (shell: LocalShellInfo) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const defaultLocalShell = useSettingsStore((s) => s.defaultLocalShell);
  const [shells, setShells] = useState<LocalShellInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    api
      .listLocalShells()
      .then((rows) => {
        if (!disposed) setShells(rows);
      })
      .catch(console.error)
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shells;
    return shells.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [shells, query]);

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t("hosts.localShellLoading")}
      </div>
    );
  }

  if (shells.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[320px] items-center justify-center px-4 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        {t("hosts.noLocalShells")}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("hosts.localShellSearch")}
        className="h-9 shrink-0"
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("hosts.searchNoMatch")}
          </div>
        ) : (
          filtered.map((shell) => {
            const isDefault =
              shell.id === defaultLocalShell ||
              (!defaultLocalShell && shell.isDefault);
            return (
              <button
                key={shell.id}
                type="button"
                className={cn(rowClass, "justify-between")}
                onClick={() => onConnect(shell)}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="truncate text-sm font-semibold">
                    {shell.name}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {shell.path}
                  </div>
                </div>
                {isDefault ? (
                  <Badge variant="secondary">{t("switcher.default")}</Badge>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
