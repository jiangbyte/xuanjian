/**
 * @file 统一文件系统操作（local / SFTP / WSL）
 * @author Charlie
 */

import type { FsEndpoint } from "@/lib/fs/types";
import { getHost } from "@/lib/db";
import { api, type SftpEntry } from "@/lib/tauri";

export type { FsEndpoint, FsKind } from "@/lib/fs/types";
export { resolveFsEndpoint } from "@/lib/fs/types";

export async function fsHomeDir(ep: FsEndpoint): Promise<string> {
  if (ep.kind === "sftp") {
    if (ep.hostId != null) {
      const host = await getHost(ep.hostId);
      if (host?.remote_path?.trim()) return host.remote_path.trim();
    }
    return "/";
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    return api.wslHomeDir(ep.sessionId);
  }
  return api.getHomeDir();
}

export async function fsListDir(
  ep: FsEndpoint,
  path: string,
): Promise<SftpEntry[]> {
  if (ep.kind === "sftp" && ep.sessionId) {
    return api.sftpList(ep.sessionId, path || "/");
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    return api.wslListDir(ep.sessionId, path);
  }
  return api.listLocalDir(path);
}

export async function fsReadFile(
  ep: FsEndpoint,
  path: string,
): Promise<string> {
  if (ep.kind === "sftp" && ep.sessionId) {
    return api.sftpRead(ep.sessionId, path);
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    return api.wslReadFile(ep.sessionId, path);
  }
  return api.readLocalFile(path);
}

export async function fsWriteFile(
  ep: FsEndpoint,
  path: string,
  content: string,
): Promise<void> {
  if (ep.kind === "sftp" && ep.sessionId) {
    await api.sftpWrite(ep.sessionId, path, content);
    return;
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    await api.wslWriteFile(ep.sessionId, path, content);
    return;
  }
  await api.writeLocalFile(path, content);
}

export async function fsMkdir(ep: FsEndpoint, path: string): Promise<void> {
  if (ep.kind === "sftp" && ep.sessionId) {
    await api.sftpMkdir(ep.sessionId, path);
    return;
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    await api.wslMkdir(ep.sessionId, path);
    return;
  }
  await api.createLocalDir(path);
}

export async function fsRename(
  ep: FsEndpoint,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (ep.kind === "sftp" && ep.sessionId) {
    await api.sftpRename(ep.sessionId, oldPath, newPath);
    return;
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    await api.wslRename(ep.sessionId, oldPath, newPath);
    return;
  }
  await api.renameLocalPath(oldPath, newPath);
}

export async function fsRemove(
  ep: FsEndpoint,
  path: string,
  isDir: boolean,
): Promise<void> {
  if (ep.kind === "sftp" && ep.sessionId) {
    await api.sftpRemove(ep.sessionId, path, isDir);
    return;
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    await api.wslRemove(ep.sessionId, path, isDir);
    return;
  }
  await api.removeLocalPath(path);
}

export async function fsChmod(
  ep: FsEndpoint,
  path: string,
  mode: number,
): Promise<void> {
  if (ep.kind === "sftp" && ep.sessionId) {
    await api.sftpChmod(ep.sessionId, path, mode);
    return;
  }
  if (ep.kind === "wsl" && ep.sessionId) {
    await api.wslChmod(ep.sessionId, path, mode);
    return;
  }
  await api.chmodLocalPath(path, mode);
}
