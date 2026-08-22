/**
 * @file SFTP / 本地传输冲突处理
 * @author Charlie
 * @description 检测目标路径是否已存在，弹窗询问覆盖 / 跳过 / 全部策略，
 * 并在覆盖前清理类型冲突或本地文件，以便安全写入。
 */

import type { DialogApi } from "@/lib/ui/dialogs";
import { api, type SftpEntry } from "@/lib/tauri";

/** 覆盖策略：每次询问 / 一律覆盖 / 一律跳过 */
export type OverwriteMode = "ask" | "overwrite" | "skip";

/** 批量传输过程中共享的冲突上下文（可被「全部」动作改写） */
export type ConflictCtx = {
  mode: OverwriteMode;
};

/** 目标端点：远程 SFTP 或本机路径 */
export type DestEndpoint = {
  remote: boolean;
  sessionId: string | null;
};

function basename(path: string) {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : path;
}

/** 在目标父目录中查找同名条目；失败返回 null */
export async function findDestEntry(
  dest: DestEndpoint,
  parentPath: string,
  name: string,
): Promise<SftpEntry | null> {
  try {
    const entries = dest.remote
      ? await api.sftpList(dest.sessionId!, parentPath || "/")
      : await api.listLocalDir(parentPath);
    return entries.find((e) => e.name === name) ?? null;
  } catch {
    return null;
  }
}

/** 删除目标路径（文件或目录） */
export async function removeDestPath(
  dest: DestEndpoint,
  path: string,
  isDir: boolean,
) {
  if (dest.remote) {
    if (!dest.sessionId) throw new Error("session missing");
    await api.sftpRemove(dest.sessionId, path, isDir);
  } else {
    await api.removeLocalPath(path);
  }
}

/**
 * 询问如何处理已存在的目标。
 * 返回是否覆盖、跳过本项，或中止整批传输。
 */
export async function askOverwrite(
  dialog: DialogApi,
  t: (key: string, opts?: Record<string, unknown>) => string,
  ctx: ConflictCtx,
  destPath: string,
  destIsDir: boolean,
  srcIsDir: boolean,
): Promise<"overwrite" | "skip" | "abort"> {
  if (ctx.mode === "overwrite") return "overwrite";
  if (ctx.mode === "skip") return "skip";

  const typeClash = destIsDir !== srcIsDir;
  const message = typeClash
    ? t("transfer.conflictTypeClash", { path: destPath })
    : srcIsDir
      ? t("transfer.conflictDir", { path: destPath })
      : t("transfer.conflictFile", { path: destPath });

  const id = await dialog.choice(message, {
    title: t("transfer.conflictTitle"),
    actions: [
      { id: "skip", label: t("transfer.skip") },
      { id: "skipAll", label: t("transfer.skipAll") },
      { id: "overwrite", label: t("transfer.overwrite"), primary: true },
      { id: "overwriteAll", label: t("transfer.overwriteAll"), danger: true },
    ],
  });

  if (id === "overwrite") return "overwrite";
  if (id === "skip") return "skip";
  if (id === "overwriteAll") {
    ctx.mode = "overwrite";
    return "overwrite";
  }
  if (id === "skipAll") {
    ctx.mode = "skip";
    return "skip";
  }
  return "abort";
}

/**
 * 为覆盖写入准备目标：类型不一致则先删除；
 * 本地文件会先删再写以保证干净截断。远程文件由 sftp.create 截断；同类型目录合并。
 */
export async function prepareOverwrite(
  dest: DestEndpoint,
  destPath: string,
  existing: SftpEntry,
  srcIsDir: boolean,
) {
  if (existing.isDir !== srcIsDir) {
    await removeDestPath(dest, destPath, existing.isDir);
  } else if (!srcIsDir && !dest.remote) {
    // 本地文件：先删除再写，保证干净截断
    await removeDestPath(dest, destPath, false);
  }
  // 远程文件：sftp.create 会截断。同类型目录则合并。
}

/** 从完整路径取出目标文件名 */
export function destNameFromPath(path: string) {
  return basename(path);
}
