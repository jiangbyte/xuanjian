/**
 * @file 本地路径批量上传到远程目录
 * @author Charlie
 * @description 批量路径先全部收集再一次性入队；文件夹带分组便于控制进度。
 */

import { joinPath } from "@/features/terminal/sftp/pathUtils";
import type { SideEndpoint } from "@/features/terminal/sftp/types";
import { collectTransferTree } from "@/features/terminal/sftp/transferEnqueue";
import { api } from "@/lib/tauri";
import { dialogs } from "@/lib/ui/dialogs";
import type { ConflictCtx } from "@/lib/transfer/conflict";
import {
  type TransferEnqueueInput,
  useTransferStore,
  waitForTransferJobs,
} from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";
import { toast } from "sonner";

async function isLocalDir(path: string): Promise<boolean> {
  try {
    await api.listLocalDir(path);
    return true;
  } catch {
    return false;
  }
}

function basename(path: string) {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : path;
}

/** 将本地文件/文件夹上传到远程 cwd，支持冲突询问与等待完成 */
export async function uploadLocalPathsToRemote(opts: {
  sessionId: string;
  cwd: string;
  localPaths: string[];
  t: (key: string, o?: Record<string, unknown>) => string;
  wait?: boolean;
  onReload?: () => Promise<void>;
}): Promise<{ enqueued: number; jobIds: string[] }> {
  const { sessionId, cwd, localPaths, t, wait = true, onReload } = opts;
  if (!localPaths.length) return { enqueued: 0, jobIds: [] };

  const conflict: ConflictCtx = { mode: "ask" };
  const src: SideEndpoint = { remote: false, sessionId: null, cwd: "" };
  const dst: SideEndpoint = { remote: true, sessionId, cwd };
  const jobs: TransferEnqueueInput[] = [];
  let enqueued = 0;

  useUiStore.getState().setTransferOpen(true);
  const preparing =
    localPaths.length > 1
      ? toast.loading(t("transfer.preparingQueue"))
      : undefined;

  try {
    for (const p of localPaths) {
      const name = basename(p);
      if (!name) continue;
      const destPath = joinPath(cwd, name, true);
      const isDir = await isLocalDir(p);

      const result = await collectTransferTree(
        src,
        dst,
        p,
        destPath,
        isDir,
        undefined,
        dialogs,
        t,
        conflict,
        jobs,
        isDir
          ? { groupId: crypto.randomUUID(), groupName: name }
          : undefined,
      );
      if (result === "abort") break;
      enqueued += 1;
    }

    if (localPaths.length > 1) {
      const looseGroupId = crypto.randomUUID();
      const looseName = t("transfer.folder");
      for (const job of jobs) {
        if (!job.groupId) {
          job.groupId = looseGroupId;
          job.groupName = looseName;
        }
      }
    }

    const jobIds = jobs.length
      ? useTransferStore.getState().enqueueMany(jobs)
      : [];

    if (wait && jobIds.length) {
      await waitForTransferJobs(jobIds, 10 * 60_000);
    }
    if (onReload) await onReload();

    return { enqueued, jobIds };
  } finally {
    if (preparing !== undefined) toast.dismiss(preparing);
  }
}
