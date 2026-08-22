/**
 * @file SFTP 传输入队与目录操作
 * @author Charlie
 * @description 连接主机、列举/创建目录，以及单文件与目录树的冲突处理与入队。
 */

import { joinPath, parentPath } from "@/features/terminal/sftp/pathUtils";
import type { SideEndpoint } from "@/features/terminal/sftp/types";
import type { HostRow } from "@/lib/db";
import type { DialogApi } from "@/lib/ui/dialogs";
import { api } from "@/lib/tauri";
import {
  askOverwrite,
  type ConflictCtx,
  type DestEndpoint,
  findDestEntry,
  prepareOverwrite,
} from "@/lib/transfer/conflict";
import {
  enqueueDownload,
  enqueueRemoteCopy,
  enqueueUpload,
} from "@/stores/transfer";

/** 按主机配置建立 SSH 会话 */
export async function connectHost(host: HostRow) {
  return api.sshConnect({
    host: host.host,
    port: host.port,
    username: host.username,
    authType: host.auth_type === "private_key" ? "privateKey" : host.auth_type,
    password: host.password_enc,
    privateKeyPath: host.private_key_path,
    passphrase: host.passphrase_enc,
    title: host.name,
    terminalType: host.terminal_type,
  });
}

/** 列举本地或远程目录条目 */
export async function listSide(ep: SideEndpoint, path: string) {
  if (ep.remote) {
    if (!ep.sessionId) throw new Error("session missing");
    return api.sftpList(ep.sessionId, path || "/");
  }
  return api.listLocalDir(path);
}

/** 确保目标目录存在（远程 mkdir 失败时忽略已存在） */
export async function ensureDir(ep: SideEndpoint, path: string) {
  if (ep.remote) {
    if (!ep.sessionId) throw new Error("session missing");
    try {
      await api.sftpMkdir(ep.sessionId, path);
    } catch {
      /* may already exist */
    }
  } else {
    await api.createLocalDir(path);
  }
}

/** 将单个文件入队上传/下载/远程复制，或本地读写拷贝 */
export async function enqueueTransferFile(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  size?: number,
) {
  if (!src.remote && dst.remote) {
    if (!dst.sessionId) throw new Error("dest session missing");
    enqueueUpload(dst.sessionId, srcPath, destPath, size);
  } else if (src.remote && !dst.remote) {
    if (!src.sessionId) throw new Error("source session missing");
    enqueueDownload(src.sessionId, srcPath, destPath, size);
  } else if (src.remote && dst.remote) {
    if (!src.sessionId || !dst.sessionId) throw new Error("sessions missing");
    enqueueRemoteCopy(src.sessionId, dst.sessionId, srcPath, destPath, size);
  } else {
    const content = await api.readLocalFile(srcPath);
    await api.writeLocalFile(destPath, content);
  }
}

/** 递归入队目录树传输，含覆盖冲突询问；返回 ok 或 abort */
export async function enqueueTransferTree(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  isDir: boolean,
  size: number | undefined,
  dialog: DialogApi,
  t: (key: string, opts?: Record<string, unknown>) => string,
  conflict: ConflictCtx,
): Promise<"ok" | "abort"> {
  const destEp: DestEndpoint = {
    remote: dst.remote,
    sessionId: dst.sessionId,
  };
  const parent = parentPath(destPath, dst.remote);
  const name = destPath.replace(/\\/g, "/").split("/").pop()!;
  const existing = await findDestEntry(destEp, parent, name);

  if (existing) {
    const decision = await askOverwrite(
      dialog,
      t,
      conflict,
      destPath,
      existing.isDir,
      isDir,
    );
    if (decision === "abort") return "abort";
    if (decision === "skip") return "ok";
    await prepareOverwrite(destEp, destPath, existing, isDir);
  }

  if (!isDir) {
    await enqueueTransferFile(src, dst, srcPath, destPath, size);
    return "ok";
  }
  await ensureDir(dst, destPath);
  const children = await listSide(src, srcPath);
  for (const child of children) {
    const result = await enqueueTransferTree(
      src,
      dst,
      child.path,
      joinPath(destPath, child.name, dst.remote),
      child.isDir,
      child.size,
      dialog,
      t,
      conflict,
    );
    if (result === "abort") return "abort";
  }
  return "ok";
}
