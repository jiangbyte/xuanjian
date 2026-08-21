/**
 * @file 传输任务列表面板
 * @author Charlie
 * @description 展示上传/下载/复制任务队列；筛选与操作用 Tabs / 卡片行。
 */

import { ArrowDownUp, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContextMenuItem,
  openContextMenu,
  useContextMenu,
} from "@/components/ContextMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  filterJobs,
  formatBytes,
  TransferFilter,
  type TransferJob,
  useTransferStore,
} from "@/stores/transfer";

const TABS: { id: TransferFilter; labelKey: string }[] = [
  { id: "all", labelKey: "transfer.tabAll" },
  { id: "running", labelKey: "transfer.tabRunning" },
  { id: "queued", labelKey: "transfer.tabQueued" },
  { id: "paused", labelKey: "transfer.tabPaused" },
  { id: "needs", labelKey: "transfer.tabNeeds" },
  { id: "completed", labelKey: "transfer.tabCompleted" },
];

function kindLabel(kind: TransferJob["kind"], t: (k: string) => string) {
  if (kind === "upload") return t("transfer.upload");
  if (kind === "download") return t("transfer.download");
  return t("transfer.copy");
}

function statusLabel(status: TransferJob["status"], t: (k: string) => string) {
  switch (status) {
    case "running":
      return t("transfer.statusRunning");
    case "queued":
      return t("transfer.statusQueued");
    case "paused":
      return t("transfer.statusPaused");
    case "completed":
      return t("transfer.statusCompleted");
    case "failed":
      return t("transfer.statusFailed");
    case "cancelled":
      return t("transfer.statusCancelled");
    default:
      return status;
  }
}

function TransferRow({ job }: { job: TransferJob }) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const pause = useTransferStore((s) => s.pause);
  const resume = useTransferStore((s) => s.resume);
  const cancel = useTransferStore((s) => s.cancel);
  const retry = useTransferStore((s) => s.retry);
  const remove = useTransferStore((s) => s.remove);

  const pct =
    job.bytesTotal > 0
      ? Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100))
      : job.status === "completed"
        ? 100
        : job.status === "running"
          ? 5
          : 0;

  return (
    <div
      className="rounded-md bg-background p-2"
      onContextMenu={(e) => {
        const items: ContextMenuItem[] = [];
        if (job.status === "running" || job.status === "queued") {
          items.push({
            id: "pause",
            label: t("transfer.pause"),
            onClick: () => pause(job.id),
          });
        }
        if (job.status === "paused") {
          items.push({
            id: "resume",
            label: t("transfer.resume"),
            onClick: () => resume(job.id),
          });
        }
        if (job.status === "failed" || job.status === "cancelled") {
          items.push({
            id: "retry",
            label: t("transfer.retry"),
            onClick: () => retry(job.id),
          });
        }
        if (
          job.status === "running" ||
          job.status === "queued" ||
          job.status === "paused"
        ) {
          items.push({
            id: "cancel",
            label: t("transfer.cancel"),
            danger: true,
            onClick: () => cancel(job.id),
          });
        }
        if (items.length) items.push("sep");
        items.push({
          id: "remove",
          label: t("transfer.remove"),
          onClick: () => remove(job.id),
        });
        openContextMenu(e, openMenu, items);
      }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {job.name}
            </span>
            <Badge variant="secondary">{kindLabel(job.kind, t)}</Badge>
            <span className="text-xs text-muted-foreground">
              {statusLabel(job.status, t)}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {job.kind === "upload"
              ? `${job.localPath} → ${job.remotePath}`
              : job.kind === "download"
                ? `${job.remotePath} → ${job.localPath}`
                : `${job.remotePath} → ${job.localPath}`}
          </p>
          <Progress
            value={pct}
            className={cn(
              "h-1.5",
              job.status === "failed" &&
                "[&_[data-slot=progress-indicator]]:bg-destructive",
              job.status === "completed" &&
                "[&_[data-slot=progress-indicator]]:bg-success",
            )}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {formatBytes(job.bytesDone)}
              {job.bytesTotal > 0 ? ` / ${formatBytes(job.bytesTotal)}` : ""}
            </span>
            {job.bytesTotal > 0 ? <span>{pct}%</span> : null}
            {job.error ? (
              <span className="truncate text-destructive">{job.error}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {(job.status === "running" || job.status === "queued") && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={t("transfer.pause")}
              aria-label={t("transfer.pause")}
              onClick={() => pause(job.id)}
            >
              <Pause size={13} />
            </Button>
          )}
          {job.status === "paused" && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={t("transfer.resume")}
              aria-label={t("transfer.resume")}
              onClick={() => resume(job.id)}
            >
              <Play size={13} />
            </Button>
          )}
          {(job.status === "failed" || job.status === "cancelled") && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={t("transfer.retry")}
              aria-label={t("transfer.retry")}
              onClick={() => retry(job.id)}
            >
              <RotateCcw size={13} />
            </Button>
          )}
          {(job.status === "running" ||
            job.status === "queued" ||
            job.status === "paused") && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              title={t("transfer.cancel")}
              aria-label={t("transfer.cancel")}
              onClick={() => cancel(job.id)}
            >
              <X size={13} />
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title={t("transfer.remove")}
            aria-label={t("transfer.remove")}
            onClick={() => remove(job.id)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 传输队列面板 */
export function TransferPanel() {
  const { t } = useTranslation();
  const jobs = useTransferStore((s) => s.jobs);
  const filter = useTransferStore((s) => s.filter);
  const setFilter = useTransferStore((s) => s.setFilter);
  const pauseAll = useTransferStore((s) => s.pauseAll);
  const resumeAll = useTransferStore((s) => s.resumeAll);
  const clearFinished = useTransferStore((s) => s.clearFinished);
  const filtered = useMemo(() => filterJobs(jobs, filter), [jobs, filter]);

  const counts = useMemo(() => {
    const c: Record<TransferFilter, number> = {
      all: jobs.length,
      running: 0,
      queued: 0,
      paused: 0,
      needs: 0,
      completed: 0,
    };
    for (const j of jobs) {
      if (j.status === "running") c.running += 1;
      else if (j.status === "queued") c.queued += 1;
      else if (j.status === "paused") c.paused += 1;
      else if (j.status === "failed") c.needs += 1;
      else if (j.status === "completed") c.completed += 1;
    }
    return c;
  }, [jobs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">{t("transfer.title")}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => pauseAll()}
          >
            <Pause size={13} />
            {t("transfer.pauseAll")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => resumeAll()}
          >
            <Play size={13} />
            {t("transfer.resumeAll")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => clearFinished()}
          >
            <Trash2 size={13} />
            {t("transfer.clearFinished")}
          </Button>
        </div>
      </div>

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as TransferFilter)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList
          variant="line"
          className="h-auto w-full shrink-0 justify-start overflow-x-auto overflow-y-hidden rounded-none border-b border-border bg-transparent p-0"
        >
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="rounded-none px-2.5 py-1.5 text-xs"
            >
              {t(tab.labelKey)}
              {counts[tab.id] > 0 ? (
                <Badge variant="secondary" className="ml-1 h-4 px-1.5">
                  {counts[tab.id]}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            className="min-h-0 flex-1 overflow-auto p-2"
          >
            {filtered.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 py-8">
                <ArrowDownUp size={28} className="opacity-40" />
                <p className="text-sm text-muted-foreground">
                  {t("transfer.empty")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((job) => (
                  <TransferRow key={job.id} job={job} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
