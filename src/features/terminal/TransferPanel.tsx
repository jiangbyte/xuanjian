import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownUp,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  filterJobs,
  formatBytes,
  TransferFilter,
  useTransferStore,
  type TransferJob,
} from "../../stores/transfer";
import {
  openContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "../../components/ContextMenu";

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
      className="transfer-row"
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
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{job.name}</span>
          <span className="chip shrink-0">{kindLabel(job.kind, t)}</span>
          <span className="text-[11px] muted shrink-0">
            {statusLabel(job.status, t)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] muted">
          {job.kind === "upload"
            ? `${job.localPath} → ${job.remotePath}`
            : job.kind === "download"
              ? `${job.remotePath} → ${job.localPath}`
              : `${job.remotePath} → ${job.localPath}`}
        </div>
        <div className="transfer-progress mt-1.5">
          <div
            className={`transfer-progress-bar ${
              job.status === "failed"
                ? "is-error"
                : job.status === "completed"
                  ? "is-done"
                  : ""
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-0.5 flex gap-2 text-[10px] muted">
          <span>
            {formatBytes(job.bytesDone)}
            {job.bytesTotal > 0 ? ` / ${formatBytes(job.bytesTotal)}` : ""}
          </span>
          {job.bytesTotal > 0 ? <span>{pct}%</span> : null}
          {job.error ? (
            <span className="truncate text-[var(--danger)]">{job.error}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {(job.status === "running" || job.status === "queued") && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title={t("transfer.pause")}
            onClick={() => pause(job.id)}
          >
            <Pause size={13} />
          </button>
        )}
        {job.status === "paused" && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title={t("transfer.resume")}
            onClick={() => resume(job.id)}
          >
            <Play size={13} />
          </button>
        )}
        {(job.status === "failed" || job.status === "cancelled") && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title={t("transfer.retry")}
            onClick={() => retry(job.id)}
          >
            <RotateCcw size={13} />
          </button>
        )}
        {(job.status === "running" ||
          job.status === "queued" ||
          job.status === "paused") && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title={t("transfer.cancel")}
            onClick={() => cancel(job.id)}
          >
            <X size={13} />
          </button>
        )}
        {(job.status === "completed" ||
          job.status === "failed" ||
          job.status === "cancelled") && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title={t("transfer.remove")}
            onClick={() => remove(job.id)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

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
    const c = {
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
    <div className="transfer-panel flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <h3 className="text-sm font-semibold">{t("transfer.title")}</h3>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => pauseAll()}
          >
            <Pause size={13} />
            {t("transfer.pauseAll")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => resumeAll()}
          >
            <Play size={13} />
            {t("transfer.resumeAll")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => clearFinished()}
          >
            <Trash2 size={13} />
            {t("transfer.clearFinished")}
          </button>
        </div>
      </div>
      <div className="transfer-tabs flex gap-0 overflow-x-auto border-b border-[var(--border)] px-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`transfer-tab ${filter === tab.id ? "is-active" : ""}`}
            onClick={() => setFilter(tab.id)}
          >
            {t(tab.labelKey)}
            {counts[tab.id] > 0 ? (
              <span className="count-badge ml-1">{counts[tab.id]}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 py-8 text-sm muted">
            <ArrowDownUp size={28} className="opacity-40" />
            {t("transfer.empty")}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((job) => (
              <TransferRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
