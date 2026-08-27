/**
 * @file 批量执行控制台
 * @author Charlie
 */

import {
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Server,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ConsoleEmptyState,
  ConsolePageHeader,
} from "@/components/ConsolePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runBatchScript, type BatchRunResult } from "@/lib/automation/batch";
import {
  createJobRun,
  finishJobRun,
  listJobRuns,
  type JobRunRow,
} from "@/lib/db/automation";
import { listGroups, listHosts, listScripts, type HostRow } from "@/lib/db";
import { selectionCheckboxClass, selectionRow } from "@/lib/core/selection";
import { cn } from "@/lib/utils";

const ALL_GROUPS = "all";

function jobStatusVariant(status: string) {
  if (status === "ok" || status === "running") return "secondary" as const;
  return "destructive" as const;
}

function PanelHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

/** 批量脚本执行主界面 */
export function BatchConsole() {
  const { t } = useTranslation();
  const [scripts, setScripts] = useState<
    Awaited<ReturnType<typeof listScripts>>
  >([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof listGroups>>>(
    [],
  );
  const [scriptId, setScriptId] = useState<number | null>(null);
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(
    new Set(),
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BatchRunResult | null>(null);
  const [runs, setRuns] = useState<JobRunRow[]>([]);

  const reload = useCallback(async () => {
    const [s, h, g, r] = await Promise.all([
      listScripts(),
      listHosts(),
      listGroups(),
      listJobRuns(20),
    ]);
    setScripts(s);
    setHosts(h);
    setGroups(g);
    setRuns(r);
    setScriptId((prev) => prev ?? s[0]?.id ?? null);
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const filteredHosts = useMemo(() => {
    if (groupFilter === ALL_GROUPS) return hosts;
    const gid = Number(groupFilter);
    return hosts.filter((h) => h.group_id === gid);
  }, [hosts, groupFilter]);

  const groupName = useMemo(() => {
    if (groupFilter === ALL_GROUPS) return t("automation.allGroups");
    return groups.find((g) => g.id === Number(groupFilter))?.name ?? "";
  }, [groupFilter, groups, t]);

  const toggleHost = (id: number) => {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllShown = () => {
    setSelectedHostIds(new Set(filteredHosts.map((h) => h.id)));
  };

  const clearSelection = () => setSelectedHostIds(new Set());

  const onRun = async () => {
    if (scriptId == null || !selectedHostIds.size || running) return;
    setRunning(true);
    setResult(null);
    const runId = await createJobRun({ job_type: "batch", status: "running" });
    try {
      const batch = await runBatchScript({
        script_id: scriptId,
        host_ids: [...selectedHostIds],
      });
      setResult(batch);
      await finishJobRun(runId, "ok", JSON.stringify(batch));
      const ok = batch.results.filter((r) => r.ok).length;
      toast.success(t("automation.batchDone"), {
        description: t("automation.batchDoneDesc", {
          ok,
          total: batch.results.length,
        }),
      });
      setRuns(await listJobRuns(20));
    } catch (e) {
      await finishJobRun(runId, "error", JSON.stringify({ error: String(e) }));
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  };

  const okCount = result?.results.filter((r) => r.ok).length ?? 0;
  const totalCount = result?.results.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConsolePageHeader
        icon={Zap}
        title={t("automation.title")}
        description={t("automation.subtitle")}
        toolbar={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => reload().catch(console.error)}
          >
            <RefreshCw size={14} />
            {t("terminal.refresh")}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 w-full flex-col border-b border-border lg:w-[400px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <PanelHead
            title={t("automation.sectionConfig")}
            description={t("automation.sectionConfigDesc")}
          />
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            <div className="space-y-2">
              <Label>{t("automation.script")}</Label>
              <Select
                value={scriptId != null ? String(scriptId) : undefined}
                onValueChange={(v) => setScriptId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("automation.pickScript")} />
                </SelectTrigger>
                <SelectContent>
                  {scripts.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{t("automation.targets")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={groupFilter} onValueChange={setGroupFilter}>
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_GROUPS}>
                        {t("automation.allGroups")}
                      </SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAllShown}
                  >
                    {t("batch.selectAll")}
                  </Button>
                  {selectedHostIds.size > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={clearSelection}
                    >
                      {t("automation.clearSelection")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{groupName}</span>
                <span>
                  {t("batch.selected", { count: selectedHostIds.size })}
                </span>
              </div>

              <div className="max-h-72 overflow-auto border border-border">
                {filteredHosts.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {t("automation.noHosts")}
                  </p>
                ) : (
                  filteredHosts.map((h) => {
                    const selected = selectedHostIds.has(h.id);
                    return (
                      <label
                        key={h.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40",
                          selectionRow(selected),
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          className={selectionCheckboxClass}
                          onCheckedChange={() => toggleHost(h.id)}
                        />
                        <Server
                          size={15}
                          className="shrink-0 text-muted-foreground"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {h.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {h.username}@{h.host}:{h.port}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={running || scriptId == null || !selectedHostIds.size}
              onClick={() => onRun().catch(console.error)}
            >
              {running ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              {t("automation.runBatch")}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PanelHead
            title={t("automation.results")}
            description={
              result
                ? t("automation.resultsSummary", {
                    ok: okCount,
                    total: totalCount,
                  })
                : t("automation.noResults")
            }
            actions={
              result ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  {okCount}
                  <XCircle size={14} className="ml-1 text-destructive" />
                  {totalCount - okCount}
                </div>
              ) : null
            }
          />
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {!result ? (
              <ConsoleEmptyState
                icon={Play}
                title={t("automation.noResults")}
                description={t("automation.noResultsHint")}
              />
            ) : (
              <ul className="space-y-0 border border-border">
                {result.results.map((r) => (
                  <li
                    key={r.host_id}
                    className={cn(
                      "border-b border-border px-3 py-2.5 last:border-b-0",
                      !r.ok && "bg-destructive/5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {r.ok ? (
                        <CheckCircle2
                          size={14}
                          className="shrink-0 text-emerald-600"
                        />
                      ) : (
                        <XCircle
                          size={14}
                          className="shrink-0 text-destructive"
                        />
                      )}
                      <span className="truncate text-sm font-medium">
                        {r.host_name}
                      </span>
                      <Badge
                        variant={r.ok ? "secondary" : "destructive"}
                        className="ml-auto text-[10px]"
                      >
                        {r.ok ? "OK" : "ERR"}
                      </Badge>
                    </div>
                    <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap border border-border/60 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {r.output || r.error || "—"}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-border">
            <PanelHead title={t("automation.recentRuns")} />
            <div className="max-h-44 overflow-auto">
              {runs.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {t("automation.noRecentRuns")}
                </p>
              ) : (
                <div className="border-t border-border">
                  <div className="grid grid-cols-[56px_1fr_72px_1fr] gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span>ID</span>
                    <span>{t("automation.colType")}</span>
                    <span>{t("automation.colStatus")}</span>
                    <span>{t("automation.colTime")}</span>
                  </div>
                  {runs.map((r) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-[56px_1fr_72px_1fr] items-center gap-2 border-b border-border px-4 py-2 text-xs last:border-b-0"
                    >
                      <span className="font-mono text-muted-foreground">
                        #{r.id}
                      </span>
                      <span>{r.job_type}</span>
                      <Badge
                        variant={jobStatusVariant(r.status)}
                        className="w-fit text-[10px]"
                      >
                        {r.status}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {r.started_at}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
