/**
 * @file 工作空间同步引擎（mtime 对比 + dry-run）
 * @author Charlie
 */

import {
  parseExcludePatterns,
  type WorkspaceRow,
} from "@/lib/db/workspaces";
import {
  mapLocalToRemote,
  sandboxLocalPath,
} from "@/lib/workspace/pathSandbox";
import { resolveWorkspaceFsEndpoint } from "@/lib/workspace/context";
import { api } from "@/lib/tauri";
import { enqueueUpload } from "@/stores/transfer";
import type { SftpEntry } from "@/lib/tauri";

export type SyncAction = "upload" | "skip";

export type SyncManifestEntry = {
  localPath: string;
  remotePath: string;
  relPath: string;
  action: SyncAction;
  reason: string;
  localMtime?: string | null;
  remoteMtime?: string | null;
  size?: number;
};

export type SyncManifest = {
  workspaceId: number;
  dryRun: boolean;
  entries: SyncManifestEntry[];
  uploadCount: number;
  skipCount: number;
};

function shouldExclude(relPath: string, patterns: string[]) {
  const norm = relPath.replace(/\\/g, "/");
  for (const p of patterns) {
    const pat = p.replace(/\\/g, "/");
    if (!pat) continue;
    if (pat.endsWith("*")) {
      const prefix = pat.slice(0, -1);
      if (norm.startsWith(prefix) || norm.includes(`/${prefix}`)) return true;
    } else if (norm === pat || norm.endsWith(`/${pat}`) || norm.includes(`/${pat}/`)) {
      return true;
    }
  }
  return false;
}

function parseMtime(v?: string | null): number {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

async function listLocalTree(
  root: string,
  dir: string,
  patterns: string[],
  out: Array<{ abs: string; rel: string; entry: SftpEntry }>,
) {
  const entries = await api.listLocalDir(dir);
  for (const e of entries) {
    const rel = e.path.startsWith(root)
      ? e.path.slice(root.length).replace(/^[/\\]/, "")
      : e.name;
    if (shouldExclude(rel, patterns)) continue;
    out.push({ abs: e.path, rel, entry: e });
    if (e.isDir) await listLocalTree(root, e.path, patterns, out);
  }
}

async function listRemoteTree(
  sessionId: string,
  root: string,
  dir: string,
  patterns: string[],
  remoteRoot: string,
  out: Map<string, SftpEntry>,
) {
  const entries = await api.sftpList(sessionId, dir || "/");
  for (const e of entries) {
    const rel = e.path.startsWith(remoteRoot)
      ? e.path.slice(remoteRoot.length).replace(/^\//, "")
      : e.name;
    if (shouldExclude(rel, patterns)) continue;
    out.set(rel, e);
    if (e.isDir) await listRemoteTree(sessionId, root, e.path, patterns, remoteRoot, out);
  }
}

/** 构建同步清单：本地较新或远程缺失的文件标记 upload */
export async function buildSyncManifest(
  ws: WorkspaceRow,
  opts?: { dryRun?: boolean },
): Promise<SyncManifest> {
  const dryRun = opts?.dryRun !== false;
  const patterns = parseExcludePatterns(ws.exclude_patterns);
  const rootResolved = sandboxLocalPath(ws, ".");
  if (!rootResolved.ok) throw new Error(rootResolved.error);
  const localRoot = rootResolved.abs;

  const localFiles: Array<{ abs: string; rel: string; entry: SftpEntry }> = [];
  await listLocalTree(localRoot, localRoot, patterns, localFiles);

  const remoteMap = new Map<string, SftpEntry>();
  const ep = resolveWorkspaceFsEndpoint(ws);
  if (ep?.kind === "sftp" && ep.sessionId) {
    const remoteRoot = ws.remote_root || "/";
    await listRemoteTree(
      ep.sessionId,
      remoteRoot,
      remoteRoot,
      patterns,
      remoteRoot.replace(/\/$/, ""),
      remoteMap,
    );
  }

  const entries: SyncManifestEntry[] = [];
  for (const lf of localFiles) {
    if (lf.entry.isDir) continue;
    const remotePath = mapLocalToRemote(ws, lf.abs);
    const remote = remoteMap.get(lf.rel);
    const localMt = parseMtime(lf.entry.modifiedAt);
    const remoteMt = parseMtime(remote?.modifiedAt);
    let action: SyncAction = "upload";
    let reason = "new or changed";
    if (remote && !remote.isDir) {
      if (localMt > 0 && remoteMt > 0 && localMt <= remoteMt) {
        action = "skip";
        reason = "remote is same or newer";
      } else if (localMt === remoteMt && lf.entry.size === remote.size) {
        action = "skip";
        reason = "same size and mtime";
      }
    }
    entries.push({
      localPath: lf.abs,
      remotePath,
      relPath: lf.rel,
      action,
      reason,
      localMtime: lf.entry.modifiedAt ?? null,
      remoteMtime: remote?.modifiedAt ?? null,
      size: lf.entry.size,
    });
  }

  const uploadCount = entries.filter((e) => e.action === "upload").length;
  return {
    workspaceId: ws.id,
    dryRun,
    entries,
    uploadCount,
    skipCount: entries.length - uploadCount,
  };
}

/** 按清单入队上传（非 dry-run） */
export async function applySyncManifest(
  ws: WorkspaceRow,
  manifest: SyncManifest,
): Promise<{ enqueued: number; jobIds: string[] }> {
  const sessionId = resolveWorkspaceFsEndpoint(ws)?.sessionId;
  if (!sessionId) throw new Error("SSH session required for remote sync");
  const jobIds: string[] = [];
  let enqueued = 0;
  for (const e of manifest.entries) {
    if (e.action !== "upload") continue;
    const id = enqueueUpload(sessionId, e.localPath, e.remotePath, e.size);
    jobIds.push(id);
    enqueued += 1;
  }
  return { enqueued, jobIds };
}
