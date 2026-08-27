/**
 * @file 审计事件控制台
 * @author Charlie
 */

import { ClipboardList, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConsoleEmptyState,
  ConsolePageHeader,
} from "@/components/ConsolePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { listAuditEvents, type AuditEventRow } from "@/lib/db/audit";
import { cn } from "@/lib/utils";

const ACTION_FILTERS = [
  "all",
  "agent.tool_exec",
  "agent.tool_confirm",
  "ssh.connect",
  "batch.run",
  "deploy.run",
  "alert.trigger",
  "file.write",
] as const;

type ActionFilter = (typeof ACTION_FILTERS)[number];

const ACTION_ACCENT: Record<string, string> = {
  "agent.tool_exec": "border-l-primary",
  "agent.tool_confirm": "border-l-amber-500",
  "ssh.connect": "border-l-sky-500",
  "batch.run": "border-l-violet-500",
  "deploy.run": "border-l-emerald-500",
  "alert.trigger": "border-l-orange-500",
  "file.write": "border-l-rose-500",
};

function formatDetail(raw: string | null): string {
  if (!raw?.trim()) return "—";
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const text = JSON.stringify(obj, null, 0);
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  }
}

/** 审计事件列表页 */
export function AuditConsole() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [action, setAction] = useState<ActionFilter>("all");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAuditEvents({
        action: action === "all" ? undefined : action,
        query: debounced,
        limit: 200,
      });
      setRows(list);
    } finally {
      setLoading(false);
    }
  }, [action, debounced]);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const actionLabels = useMemo(
    () =>
      ({
        all: t("audit.filterAll"),
        "agent.tool_exec": t("audit.actionToolExec"),
        "agent.tool_confirm": t("audit.actionToolConfirm"),
        "ssh.connect": t("audit.actionSshConnect"),
        "batch.run": t("audit.actionBatch"),
        "deploy.run": t("audit.actionDeploy"),
        "alert.trigger": t("audit.actionAlert"),
        "file.write": t("audit.actionFileWrite"),
      }) as Record<ActionFilter, string>,
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConsolePageHeader
        icon={ClipboardList}
        title={t("audit.title")}
        description={t("audit.subtitle")}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="min-w-0 flex-1 sm:max-w-md">
            <InputGroupAddon>
              <Search size={14} />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("audit.search")}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </InputGroup>
          <p className="text-xs text-muted-foreground">
            {loading ? "…" : t("audit.count", { count: rows.length })}
          </p>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5">
          {ACTION_FILTERS.map((k) => (
            <Button
              key={k}
              size="xs"
              variant={action === k ? "default" : "outline"}
              className="shrink-0"
              onClick={() => setAction(k)}
            >
              {actionLabels[k]}
            </Button>
          ))}
        </div>
      </ConsolePageHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-5">
            <ConsoleEmptyState
              icon={ClipboardList}
              title={t("audit.empty")}
              description={t("audit.emptyHint")}
            />
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "border-b border-border border-l-[3px] px-4 py-3",
                  ACTION_ACCENT[row.action] ?? "border-l-muted-foreground/40",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {row.action}
                  </Badge>
                  {row.target ? (
                    <span className="truncate text-sm font-medium">
                      {row.target}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {row.created_at}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {t("audit.actor")}: {row.actor || "—"}
                </div>
                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {formatDetail(row.detail_json)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
