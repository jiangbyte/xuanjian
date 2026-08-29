/**
 * @file SFTP 传输入队与目录操作
 * @author Charlie
 * @description 连接主机、列举/创建目录，以及单文件与目录树的冲突处理与入队。
 * 目录树先收集全部文件再一次性 enqueueMany，避免「传一个显示一个」。
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
  type TransferEnqueueInput,
  useTransferStore,
} from "@/stores/transfer";

function basename(path: string) {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : path;
}

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

type TransferGroup = { groupId: string; groupName: string };

/** 将单个文件描述推入收集列表（本地↔本地仍直接读写） */
export async function collectTransferFile(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  size: number | undefined,
  out: TransferEnqueueInput[],
  group?: TransferGroup,
) {
  if (!src.remote && dst.remote) {
    if (!dst.sessionId) throw new Error("dest session missing");
    out.push({
      kind: "upload",
      sessionId: dst.sessionId,
      localPath: srcPath,
      remotePath: destPath,
      name: basename(srcPath),
      bytesTotal: size,
      groupId: group?.groupId,
      groupName: group?.groupName,
    });
  } else if (src.remote && !dst.remote) {
    if (!src.sessionId) throw new Error("source session missing");
    out.push({
      kind: "download",
      sessionId: src.sessionId,
      localPath: destPath,
      remotePath: srcPath,
      name: basename(srcPath),
      bytesTotal: size,
      groupId: group?.groupId,
      groupName: group?.groupName,
    });
  } else if (src.remote && dst.remote) {
    if (!src.sessionId || !dst.sessionId) throw new Error("sessions missing");
    out.push({
      kind: "copy",
      sessionId: src.sessionId,
      destSessionId: dst.sessionId,
      localPath: destPath,
      remotePath: srcPath,
      name: basename(srcPath),
      bytesTotal: size,
      groupId: group?.groupId,
      groupName: group?.groupName,
    });
  } else {
    const content = await api.readLocalFile(srcPath);
    await api.writeLocalFile(destPath, content);
  }
}

/** 递归收集目录树传输任务（含覆盖冲突询问）；不入队 */
export async function collectTransferTree(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  isDir: boolean,
  size: number | undefined,
  dialog: DialogApi,
  t: (key: string, opts?: Record<string, unknown>) => string,
  conflict: ConflictCtx,
  out: TransferEnqueueInput[],
  group?: TransferGroup,
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
    await collectTransferFile(src, dst, srcPath, destPath, size, out, group);
    return "ok";
  }
  await ensureDir(dst, destPath);
  const children = await listSide(src, srcPath);
  for (const child of children) {
    const result = await collectTransferTree(
      src,
      dst,
      child.path,
      joinPath(destPath, child.name, dst.remote),
      child.isDir,
      child.size,
      dialog,
      t,
      conflict,
      out,
      group,
    );
    if (result === "abort") return "abort";
  }
  return "ok";
}

/**
 * 递归入队目录树传输：先收集全部文件再一次性入队。
 * 文件夹会带上 groupId，便于面板按组控制进度。
 */
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
  const jobs: TransferEnqueueInput[] = [];
  const group: TransferGroup | undefined = isDir
    ? { groupId: crypto.randomUUID(), groupName: basename(srcPath) }
    : undefined;
  const result = await collectTransferTree(
    src,
    dst,
    srcPath,
    destPath,
    isDir,
    size,
    dialog,
    t,
    conflict,
    jobs,
    group,
  );
  if (result === "abort") return "abort";
  if (jobs.length) {
    useTransferStore.getState().enqueueMany(jobs);
  }
  return "ok";
}

/** @deprecated 保留兼容：单文件仍走收集+入队 */
export async function enqueueTransferFile(
  src: SideEndpoint,
  dst: SideEndpoint,
  srcPath: string,
  destPath: string,
  size?: number,
) {
  const jobs: TransferEnqueueInput[] = [];
  await collectTransferFile(src, dst, srcPath, destPath, size, jobs);
  if (jobs.length) useTransferStore.getState().enqueueMany(jobs);
}
