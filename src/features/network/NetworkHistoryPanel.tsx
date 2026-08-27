/**
 * @file 网络历史列表面板
 * @author Charlie
 */

import { Globe, History, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConsoleEmptyState } from "@/components/ConsolePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearNetworkHistory,
  listNetworkHistory,
  type NetworkHistoryRow,
} from "@/lib/db/networkHistory";
import { dialogs } from "@/lib/ui/dialogs";
import { cn } from "@/lib/utils";

const ALL_KINDS = "all";

const KIND_STYLE: Record<string, string> = {
  ping: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  dns: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  tcp: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  http: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  tls: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  trace: "bg-orange-500/10 text-orange-800 dark:text-orange-200",
};

/** 网络探测历史列表 */
export function NetworkHistoryPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<NetworkHistoryRow[]>([]);
  const [kind, setKind] = useState(ALL_KINDS);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listNetworkHistory(200);
      setRows(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const kinds = useMemo(() => {
    const set = new Set(rows.map((r) => r.kind));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (kind === ALL_KINDS) return rows;
    return rows.filter((r) => r.kind === kind);
  }, [rows, kind]);

  const onClear = async () => {
    const ok = await dialogs.confirm(t("networkHistory.clearConfirm"));
    if (!ok) return;
    await clearNetworkHistory();
    await reload();
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <History size={16} className="text-muted-foreground" />
        <span className="text-sm font-semibold">
          {t("networkHistory.title")}
        </span>
        <Badge variant="outline" className="ml-1 text-[10px] font-normal">
          {filtered.length}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>
                {t("networkHistory.allKinds")}
              </SelectItem>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title={t("networkHistory.clear")}
            onClick={() => onClear().catch(console.error)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-3">
            <ConsoleEmptyState
              icon={Globe}
              title={t("networkHistory.empty")}
              description={t("networkHistory.emptyHint")}
            />
          </div>
        ) : (
          <ul>
            {filtered.map((r) => (
              <li
                key={r.id}
                className="border-b border-border px-4 py-2.5 hover:bg-muted/20"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      KIND_STYLE[r.kind] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {r.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.target}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {r.created_at}
                  </span>
                </div>
                {r.detail ? (
                  <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {r.detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
