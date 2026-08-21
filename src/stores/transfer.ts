import { create } from "zustand";
import { api } from "../lib/tauri";
import { useUiStore } from "./ui";

export type TransferKind = "upload" | "download" | "copy";

export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TransferJob = {
  id: string;
  kind: TransferKind;
  sessionId?: string | null;
  /** Second session for remote→remote. */
  destSessionId?: string | null;
  localPath: string;
  remotePath: string;
  /** Display name */
  name: string;
  bytesDone: number;
  bytesTotal: number;
  status: TransferStatus;
  /** Remote→remote: which leg is in progress. */
  phase?: "download" | "upload";
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type TransferFilter =
  | "all"
  | "running"
  | "queued"
  | "paused"
  | "needs"
  | "completed";

type TransferState = {
  jobs: TransferJob[];
  filter: TransferFilter;
  concurrency: number;
  runningCount: number;
  setFilter: (f: TransferFilter) => void;
  enqueue: (
    input: Omit<
      TransferJob,
      | "id"
      | "bytesDone"
      | "bytesTotal"
      | "status"
      | "createdAt"
      | "updatedAt"
    > & { bytesTotal?: number },
  ) => string;
  pause: (id: string) => void;
  resume: (id: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  updateProgress: (id: string, bytesDone: number, bytesTotal: number) => void;
  kick: () => void;
};

function now() {
  return Date.now();
}

function basename(path: string) {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : path;
}

function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

async function runJob(jobId: string): Promise<void> {
  const job = useTransferStore.getState().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("job missing");
  const { id, kind, sessionId, destSessionId, localPath, remotePath } = job;
  const resume = job.bytesDone > 0 ? job.bytesDone : undefined;

  if (kind === "upload") {
    if (!sessionId) throw new Error("session missing");
    await api.sftpUpload(sessionId, localPath, remotePath, id, resume ?? null);
    return;
  }
  if (kind === "download") {
    if (!sessionId) throw new Error("session missing");
    await api.sftpDownload(sessionId, remotePath, localPath, id, resume ?? null);
    return;
  }
  // remote → remote via temp
  if (!sessionId || !destSessionId) throw new Error("sessions missing");
  const tempRoot = await api.getTempDir();
  const tempPath = `${tempRoot.replace(/[/\\]$/, "")}/xuanjian-xfer-${id}`;
  const phase = job.phase ?? "download";

  if (phase === "download") {
    await api.sftpDownload(
      sessionId,
      remotePath,
      tempPath,
      id,
      resume ?? null,
    );
    const cur = useTransferStore.getState().jobs.find((j) => j.id === id);
    if (cur?.status === "paused" || cur?.status === "cancelled") return;
    useTransferStore.setState((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id
          ? {
              ...j,
              phase: "upload",
              bytesDone: 0,
              updatedAt: now(),
            }
          : j,
      ),
    }));
  }

  const again = useTransferStore.getState().jobs.find((j) => j.id === id);
  if (!again || again.status === "paused" || again.status === "cancelled") {
    return;
  }
  const uploadResume =
    again.phase === "upload" && again.bytesDone > 0 ? again.bytesDone : undefined;
  try {
    await api.sftpUpload(
      destSessionId,
      tempPath,
      localPath || remotePath,
      id,
      uploadResume ?? null,
    );
  } finally {
    const still = useTransferStore.getState().jobs.find((j) => j.id === id);
    if (still?.status !== "paused") {
      await api.removeLocalPath(tempPath).catch(() => undefined);
    }
  }
}

let kicking = false;

export const useTransferStore = create<TransferState>((set, get) => ({
  jobs: [],
  filter: "all",
  concurrency: 2,
  runningCount: 0,
  setFilter: (filter) => set({ filter }),
  enqueue: (input) => {
    const id = crypto.randomUUID();
    const job: TransferJob = {
      id,
      kind: input.kind,
      sessionId: input.sessionId,
      destSessionId: input.destSessionId,
      localPath: input.localPath,
      remotePath: input.remotePath,
      name: input.name || basename(input.remotePath || input.localPath),
      bytesDone: 0,
      bytesTotal: input.bytesTotal ?? 0,
      status: "queued",
      createdAt: now(),
      updatedAt: now(),
    };
    set((s) => ({ jobs: [job, ...s.jobs] }));
    useUiStore.getState().setTransferOpen(true);
    queueMicrotask(() => get().kick());
    return id;
  },
  pause: (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const wasRunning = job.status === "running";
    // Mark paused first so the in-flight runner never promotes to cancelled.
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id && (j.status === "queued" || j.status === "running")
          ? { ...j, status: "paused", error: undefined, updatedAt: now() }
          : j,
      ),
    }));
    if (wasRunning) {
      api.sftpTransferCancel(id, true).catch(() => undefined);
    }
  },
  resume: (id) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id && j.status === "paused"
          ? { ...j, status: "queued", error: undefined, updatedAt: now() }
          : j,
      ),
    }));
    get().kick();
  },
  pauseAll: () => {
    const ids = get()
      .jobs.filter((j) => j.status === "queued" || j.status === "running")
      .map((j) => j.id);
    for (const id of ids) get().pause(id);
  },
  resumeAll: () => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.status === "paused"
          ? { ...j, status: "queued", error: undefined, updatedAt: now() }
          : j,
      ),
    }));
    get().kick();
  },
  cancel: (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (
      !job ||
      (job.status !== "queued" &&
        job.status !== "running" &&
        job.status !== "paused")
    ) {
      return;
    }
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id &&
        (j.status === "queued" ||
          j.status === "running" ||
          j.status === "paused")
          ? { ...j, status: "cancelled", updatedAt: now() }
          : j,
      ),
    }));
    if (job.status === "running") {
      api.sftpTransferCancel(id, false).catch(() => undefined);
    }
    get().kick();
  },
  retry: (id) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id &&
        (j.status === "failed" || j.status === "cancelled")
          ? {
              ...j,
              status: "queued",
              bytesDone: 0,
              phase: undefined,
              error: undefined,
              updatedAt: now(),
            }
          : j,
      ),
    }));
    get().kick();
  },
  remove: (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (
      job &&
      (job.status === "running" ||
        job.status === "queued" ||
        job.status === "paused")
    ) {
      api.sftpTransferCancel(id, false).catch(() => undefined);
    }
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    get().kick();
  },
  clearFinished: () => {
    set((s) => ({
      jobs: s.jobs.filter(
        (j) =>
          j.status !== "completed" &&
          j.status !== "failed" &&
          j.status !== "cancelled",
      ),
    }));
  },
  updateProgress: (id, bytesDone, bytesTotal) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id
          ? {
              ...j,
              bytesDone,
              bytesTotal: bytesTotal || j.bytesTotal,
              updatedAt: now(),
            }
          : j,
      ),
    }));
  },
  kick: () => {
    if (kicking) return;
    kicking = true;
    void (async () => {
      try {
        for (;;) {
          const state = get();
          const running = state.jobs.filter((j) => j.status === "running").length;
          const slots = Math.max(0, state.concurrency - running);
          if (slots <= 0) break;
          const next = state.jobs.find((j) => j.status === "queued");
          if (!next) break;

          set((s) => ({
            jobs: s.jobs.map((j) =>
              j.id === next.id
                ? { ...j, status: "running", updatedAt: now() }
                : j,
            ),
            runningCount: running + 1,
          }));

          void (async () => {
            try {
              await runJob(next.id);
              const cur = get().jobs.find((j) => j.id === next.id);
              if (cur?.status === "paused" || cur?.status === "cancelled") {
                return;
              }
              set((s) => ({
                jobs: s.jobs.map((j) =>
                  j.id === next.id
                    ? {
                        ...j,
                        status: "completed",
                        bytesDone: j.bytesTotal || j.bytesDone,
                        error: undefined,
                        updatedAt: now(),
                      }
                    : j,
                ),
              }));
            } catch (e) {
              const msg = errorMessage(e);
              const pausedErr = /paused/i.test(msg);
              const cancelledErr = /cancel/i.test(msg);
              set((s) => ({
                jobs: s.jobs.map((j) => {
                  if (j.id !== next.id) return j;
                  // Never overwrite an intentional pause/cancel.
                  if (j.status === "paused") {
                    return { ...j, error: undefined, updatedAt: now() };
                  }
                  if (j.status === "cancelled") {
                    return {
                      ...j,
                      error: j.error || msg,
                      updatedAt: now(),
                    };
                  }
                  if (pausedErr) {
                    return {
                      ...j,
                      status: "paused",
                      error: undefined,
                      updatedAt: now(),
                    };
                  }
                  return {
                    ...j,
                    status: cancelledErr ? "cancelled" : "failed",
                    error: msg,
                    updatedAt: now(),
                  };
                }),
              }));
            } finally {
              set((s) => ({
                runningCount: Math.max(0, s.runningCount - 1),
              }));
              get().kick();
            }
          })();
        }
      } finally {
        kicking = false;
        // If more queued appeared while we were scheduling, kick again.
        if (get().jobs.some((j) => j.status === "queued")) {
          const running = get().jobs.filter((j) => j.status === "running").length;
          if (running < get().concurrency) {
            queueMicrotask(() => get().kick());
          }
        }
      }
    })();
  },
}));

export function filterJobs(jobs: TransferJob[], filter: TransferFilter) {
  switch (filter) {
    case "running":
      return jobs.filter((j) => j.status === "running");
    case "queued":
      return jobs.filter((j) => j.status === "queued");
    case "paused":
      return jobs.filter((j) => j.status === "paused");
    case "needs":
      return jobs.filter((j) => j.status === "failed");
    case "completed":
      return jobs.filter((j) => j.status === "completed");
    default:
      return jobs;
  }
}

export function formatBytes(n: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Enqueue a simple upload. */
export function enqueueUpload(
  sessionId: string,
  localPath: string,
  remotePath: string,
  size?: number,
) {
  return useTransferStore.getState().enqueue({
    kind: "upload",
    sessionId,
    localPath,
    remotePath,
    name: basename(localPath),
    bytesTotal: size,
  });
}

export function enqueueDownload(
  sessionId: string,
  remotePath: string,
  localPath: string,
  size?: number,
) {
  return useTransferStore.getState().enqueue({
    kind: "download",
    sessionId,
    localPath,
    remotePath,
    name: basename(remotePath),
    bytesTotal: size,
  });
}

/** Remote → remote (via temp file). `destRemotePath` is stored in `localPath`. */
export function enqueueRemoteCopy(
  sessionId: string,
  destSessionId: string,
  remotePath: string,
  destRemotePath: string,
  size?: number,
) {
  return useTransferStore.getState().enqueue({
    kind: "copy",
    sessionId,
    destSessionId,
    localPath: destRemotePath,
    remotePath,
    name: basename(remotePath),
    bytesTotal: size,
  });
}

let progressListening = false;

/** Subscribe once for backend progress events (safe if panel is closed). */
export function initTransferProgressListener() {
  if (progressListening) return () => undefined;
  progressListening = true;
  let unlisten: (() => void) | undefined;
  void import("../lib/tauri").then(({ onTransferProgress }) => {
    onTransferProgress((p) => {
      useTransferStore
        .getState()
        .updateProgress(p.transferId, p.bytesDone, p.bytesTotal);
    }).then((fn) => {
      unlisten = fn;
    });
  });
  return () => {
    unlisten?.();
    progressListening = false;
  };
}
