import type { DialogApi } from "../components/Dialog";
import { api, type SftpEntry } from "./tauri";

export type OverwriteMode = "ask" | "overwrite" | "skip";

export type ConflictCtx = {
  mode: OverwriteMode;
};

export type DestEndpoint = {
  remote: boolean;
  sessionId: string | null;
};

function basename(path: string) {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : path;
}

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
 * Ask how to handle an existing destination.
 * Returns whether to proceed with overwrite, skip this item, or abort the batch.
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

/** Prepare destination for overwrite (remove if type differs; files are truncated on write). */
export async function prepareOverwrite(
  dest: DestEndpoint,
  destPath: string,
  existing: SftpEntry,
  srcIsDir: boolean,
) {
  if (existing.isDir !== srcIsDir) {
    await removeDestPath(dest, destPath, existing.isDir);
  } else if (!srcIsDir && !dest.remote) {
    // Local file: truncate by remove so write starts clean
    await removeDestPath(dest, destPath, false);
  }
  // Remote files: sftp.create truncates. Same-type dirs merge.
}

export function destNameFromPath(path: string) {
  return basename(path);
}
