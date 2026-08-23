/**
 * @file 本地路径批量上传到远程目录
 * @author Charlie
 */

import { joinPath } from "@/features/terminal/sftp/pathUtils";
import type { SideEndpoint } from "@/features/terminal/sftp/types";
import { enqueueTransferTree } from "@/features/terminal/sftp/transferEnqueue";
import { api } from "@/lib/tauri";
import { dialogs } from "@/lib/ui/dialogs";
import {
  askOverwrite,
  type ConflictCtx,
  type DestEndpoint,
  findDestEntry,
  prepareOverwrite,
} from "@/lib/transfer/conflict";
import { enqueueUpload, waitForTransferJobs } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

async function isLocalDir(path: string): Promise<boolean> {
  try {
    await api.listLocalDir(path);
    return true;
  } catch {
    return false;
  }
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
  const destEp: DestEndpoint = { remote: true, sessionId };
  const src: SideEndpoint = { remote: false, sessionId: null, cwd: "" };
  const dst: SideEndpoint = { remote: true, sessionId, cwd };
  const jobIds: string[] = [];
  let enqueued = 0;

  useUiStore.getState().setTransferOpen(true);

  for (const p of localPaths) {
    const name = p.replace(/\\/g, "/").split("/").pop();
    if (!name) continue;
    const destPath = joinPath(cwd, name, true);
    const isDir = await isLocalDir(p);

    if (isDir) {
      const result = await enqueueTransferTree(
        src,
        dst,
        p,
        destPath,
        true,
        undefined,
        dialogs,
        t,
        conflict,
      );
      if (result === "abort") break;
      enqueued += 1;
      continue;
    }

    const existing = await findDestEntry(destEp, cwd, name);
    if (existing) {
      const decision = await askOverwrite(
        dialogs,
        t,
        conflict,
        destPath,
        existing.isDir,
        false,
      );
      if (decision === "abort") break;
      if (decision === "skip") continue;
      await prepareOverwrite(destEp, destPath, existing, false);
    }
    jobIds.push(enqueueUpload(sessionId, p, destPath));
    enqueued += 1;
  }

  if (wait && jobIds.length) {
    await waitForTransferJobs(jobIds, 10 * 60_000);
  }
  if (onReload) await onReload();

  return { enqueued, jobIds };
}
