/**
 * @file 远程目录创建（SFTP 上传/写入前确保父目录存在）
 * @author Charlie
 */

import { api } from "@/lib/tauri";

function parentUnixPath(p: string): string {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  if (i <= 0) return "/";
  return s.slice(0, i) || "/";
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** 为一批远程文件路径确保所有父目录存在（单次 mkdir -p） */
export async function ensureRemoteParentDirs(
  sessionId: string,
  remotePaths: string[],
): Promise<void> {
  const dirs = new Set<string>();
  for (const p of remotePaths) {
    let cur = parentUnixPath(p);
    while (cur && cur !== "/") {
      dirs.add(cur);
      cur = parentUnixPath(cur);
    }
  }
  if (!dirs.size) return;
  const sorted = [...dirs].sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );
  const cmd = `mkdir -p ${sorted.map(shellQuote).join(" ")}`;
  await api.sessionExec(sessionId, cmd);
}

/** 为单个远程文件路径确保父目录存在 */
export async function ensureRemoteParentDir(
  sessionId: string,
  remotePath: string,
): Promise<void> {
  await ensureRemoteParentDirs(sessionId, [remotePath]);
}
