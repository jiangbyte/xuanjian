/**
 * @file 文件传输任务 Store
 * @author Charlie
 * @description 上传 / 下载 / 远端互拷队列，并发调度与进度更新。
 * 通过 Tauri SFTP API 执行；进度事件由 initTransferProgressListener 订阅。
 */

import { create } from "zustand";
import { api } from "@/lib/tauri";
import { setBlockingUi } from "@/lib/ui/blockingUi";
import { useUiStore } from "@/stores/ui";

export type TransferKind = "upload" | "download" | "copy";

export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** 单条传输任务 */
export type TransferJob = {
  id: string;
  kind: TransferKind;
  sessionId?: string | null;
  /** 远端→远端时的目标会话 */
  destSessionId?: string | null;
  localPath: string;
  remotePath: string;
  /** 展示名 */
  name: string;
  bytesDone: number;
  bytesTotal: number;
  status: TransferStatus;
  /** 远端互拷：当前阶段 */
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
      "id" | "bytesDone" | "bytesTotal" | "status" | "createdAt" | "updatedAt"
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

/** 执行单个任务：upload / download / 经临时文件的远端互拷 */
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
    await api.sftpDownload(
      sessionId,
      remotePath,
      localPath,
      id,
      resume ?? null,
    );
    return;
  }
  // 远端 → 远端：经本地临时文件
  if (!sessionId || !destSessionId) throw new Error("sessions missing");
  const tempRoot = await api.getTempDir();
  const tempPath = `${tempRoot.replace(/[/\\]$/, "")}/xuanjian-xfer-${id}`;
  const phase = job.phase ?? "download";

  if (phase === "download") {
    await api.sftpDownload(sessionId, remotePath, tempPath, id, resume ?? null);
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
    again.phase === "upload" && again.bytesDone > 0
      ? again.bytesDone
      : undefined;
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

/**
 * 传输任务 Zustand store：入队、暂停/恢复、取消与并发 kick。
 * @副作用 调用 SFTP API；enqueue 会打开传输面板
 */
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
    // 先标记 paused，避免进行中的 runner 误升为 cancelled
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
        j.id === id && (j.status === "failed" || j.status === "cancelled")
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
  /** 按并发上限从队列中启动任务 */
  kick: () => {
    if (kicking) return;
    kicking = true;
    void (async () => {
      try {
        for (;;) {
          const state = get();
          const running = state.jobs.filter(
            (j) => j.status === "running",
          ).length;
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
                  // 不覆盖用户主动的 pause/cancel
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
        // 调度期间若又有排队任务且仍有空位，再 kick
        if (get().jobs.some((j) => j.status === "queued")) {
          const running = get().jobs.filter(
            (j) => j.status === "running",
          ).length;
          if (running < get().concurrency) {
            queueMicrotask(() => get().kick());
          }
        }
      }
    })();
  },
}));

/**
 * 按筛选条件过滤任务列表。
 * @param filter `needs` 表示失败项
 */
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

/** 将字节数格式化为可读字符串 */
export function formatBytes(n: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 入队简单上传任务。
 * @returns 任务 id
 */
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

export type TransferWaitResult = {
  completed: number;
  failed: number;
  pending: number;
  errors: string[];
};

/** 等待一批传输任务结束（用于 Agent 同步后确认结果） */
export async function waitForTransferJobs(
  jobIds: string[],
  timeoutMs = 10 * 60_000,
): Promise<TransferWaitResult> {
  if (!jobIds.length) {
    return { completed: 0, failed: 0, pending: 0, errors: [] };
  }
  setBlockingUi(true, "transfer");
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const jobs = useTransferStore.getState().jobs.filter((j) =>
        jobIds.includes(j.id),
      );
      const pending = jobs.filter(
        (j) =>
          j.status === "queued" ||
          j.status === "running" ||
          j.status === "paused",
      );
      const done = jobs.length - pending.length;
      setBlockingUi(
        true,
        "transfer",
        pending.length ? `${done}/${jobs.length}` : undefined,
      );
      if (!pending.length) {
        const failed = jobs.filter((j) => j.status === "failed");
        return {
          completed: jobs.filter((j) => j.status === "completed").length,
          failed: failed.length,
          pending: jobs.filter(
            (j) => j.status === "queued" || j.status === "running",
          ).length,
          errors: failed.map(
            (j) => `${j.remotePath || j.name}: ${j.error ?? "unknown"}`,
          ),
        };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const jobs = useTransferStore.getState().jobs.filter((j) =>
      jobIds.includes(j.id),
    );
    const still = jobs.filter(
      (j) => j.status === "queued" || j.status === "running",
    );
    return {
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      pending: still.length,
      errors: still.length
        ? [`${still.length} 个传输任务超时未完成`]
        : jobs
            .filter((j) => j.status === "failed")
            .map((j) => `${j.remotePath || j.name}: ${j.error ?? "unknown"}`),
    };
  } finally {
    setBlockingUi(false);
  }
}

/**
 * 入队下载任务。
 * @returns 任务 id
 */
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

/**
 * 入队远端→远端复制（经临时文件）；目标远端路径存在 `localPath` 字段。
 * @returns 任务 id
 */
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

/**
 * 全局订阅后端传输进度事件（面板关闭时也安全）；幂等，重复调用无效。
 * @returns 取消订阅函数
 */
export function initTransferProgressListener() {
  if (progressListening) return () => undefined;
  progressListening = true;
  let unlisten: (() => void) | undefined;
  let raf = 0;
  let pending: {
    transferId: string;
    bytesDone: number;
    bytesTotal: number;
  } | null = null;

  const flush = () => {
    raf = 0;
    const p = pending;
    pending = null;
    if (!p) return;
    useTransferStore
      .getState()
      .updateProgress(p.transferId, p.bytesDone, p.bytesTotal);
  };

  void import("@/lib/tauri").then(({ onTransferProgress }) => {
    onTransferProgress((p) => {
      pending = {
        transferId: p.transferId,
        bytesDone: p.bytesDone,
        bytesTotal: p.bytesTotal,
      };
      if (!raf) {
        raf = window.setTimeout(flush, 120);
      }
    }).then((fn) => {
      unlisten = fn;
    });
  });
  return () => {
    if (raf) window.clearTimeout(raf);
    unlisten?.();
    progressListening = false;
  };
}
