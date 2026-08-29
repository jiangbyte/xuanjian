/**
 * @file 传输任务列表面板
 * @author Charlie
 * @description 展示上传/下载/复制任务队列；支持文件夹分组进度控制。
 */

import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Folder,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
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

function jobPct(job: TransferJob) {
  if (job.bytesTotal > 0) {
    return Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100));
  }
  if (job.status === "completed") return 100;
  if (job.status === "running") return 5;
  return 0;
}

type ListEntry =
  | { type: "job"; job: TransferJob }
  | { type: "group"; groupId: string; groupName: string; jobs: TransferJob[] };

/** 将筛选后的任务按 groupId 折叠为列表条目 */
function buildListEntries(jobs: TransferJob[]): ListEntry[] {
  const entries: ListEntry[] = [];
  const seenGroups = new Set<string>();
  for (const job of jobs) {
    if (!job.groupId) {
      entries.push({ type: "job", job });
      continue;
    }
    if (seenGroups.has(job.groupId)) continue;
    seenGroups.add(job.groupId);
    const groupJobs = jobs.filter((j) => j.groupId === job.groupId);
    if (groupJobs.length === 1) {
      entries.push({ type: "job", job: groupJobs[0]! });
      continue;
    }
    entries.push({
      type: "group",
      groupId: job.groupId,
      groupName: job.groupName || job.groupId,
      jobs: groupJobs,
    });
  }
  return entries;
}

function TransferRow({ job }: { job: TransferJob }) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const pause = useTransferStore((s) => s.pause);
  const resume = useTransferStore((s) => s.resume);
  const cancel = useTransferStore((s) => s.cancel);
  const retry = useTransferStore((s) => s.retry);
  const remove = useTransferStore((s) => s.remove);

  const pct = jobPct(job);

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

function TransferGroupCard({
  groupId,
  groupName,
  jobs,
}: {
  groupId: string;
  groupName: string;
  jobs: TransferJob[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const pauseGroup = useTransferStore((s) => s.pauseGroup);
  const resumeGroup = useTransferStore((s) => s.resumeGroup);
  const cancelGroup = useTransferStore((s) => s.cancelGroup);

  const bytesDone = jobs.reduce((a, j) => a + j.bytesDone, 0);
  const bytesTotal = jobs.reduce((a, j) => a + (j.bytesTotal || 0), 0);
  const doneCount = jobs.filter((j) => j.status === "completed").length;
  const hasActive = jobs.some(
    (j) =>
      j.status === "running" || j.status === "queued" || j.status === "paused",
  );
  const hasPaused = jobs.some((j) => j.status === "paused");
  const hasRunnable = jobs.some(
    (j) => j.status === "running" || j.status === "queued",
  );
  const pct =
    bytesTotal > 0
      ? Math.min(100, Math.round((bytesDone / bytesTotal) * 100))
      : Math.round((doneCount / Math.max(1, jobs.length)) * 100);
  const kind = jobs[0]?.kind ?? "upload";
  const failed = jobs.some((j) => j.status === "failed");

  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="flex items-start gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="mt-0.5"
          title={open ? t("transfer.folderCollapse") : t("transfer.folderExpand")}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Button>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <Folder size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {groupName}
            </span>
            <Badge variant="secondary">{kindLabel(kind, t)}</Badge>
            <span className="text-xs text-muted-foreground">
              {t("transfer.folderFiles", {
                done: doneCount,
                total: jobs.length,
              })}
            </span>
          </div>
          <Progress
            value={pct}
            className={cn(
              "h-1.5",
              failed && "[&_[data-slot=progress-indicator]]:bg-destructive",
              doneCount === jobs.length &&
                "[&_[data-slot=progress-indicator]]:bg-success",
            )}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {formatBytes(bytesDone)}
              {bytesTotal > 0 ? ` / ${formatBytes(bytesTotal)}` : ""}
            </span>
            <span>{pct}%</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {hasRunnable ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={t("transfer.folderPause")}
              aria-label={t("transfer.folderPause")}
              onClick={() => pauseGroup(groupId)}
            >
              <Pause size={13} />
            </Button>
          ) : null}
          {hasPaused ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={t("transfer.folderResume")}
              aria-label={t("transfer.folderResume")}
              onClick={() => resumeGroup(groupId)}
            >
              <Play size={13} />
            </Button>
          ) : null}
          {hasActive ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              title={t("transfer.folderCancel")}
              aria-label={t("transfer.folderCancel")}
              onClick={() => cancelGroup(groupId)}
            >
              <X size={13} />
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2 pl-1">
          {jobs.map((job) => (
            <TransferRow key={job.id} job={job} />
          ))}
        </div>
      ) : null}
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
  const entries = useMemo(() => buildListEntries(filtered), [filtered]);

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
            {entries.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 py-8">
                <ArrowDownUp size={28} className="opacity-40" />
                <p className="text-sm text-muted-foreground">
                  {t("transfer.empty")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) =>
                  entry.type === "group" ? (
                    <TransferGroupCard
                      key={entry.groupId}
                      groupId={entry.groupId}
                      groupName={entry.groupName}
                      jobs={entry.jobs}
                    />
                  ) : (
                    <TransferRow key={entry.job.id} job={entry.job} />
                  ),
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
