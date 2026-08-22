/**
 * @file 工作空间路径沙箱
 * @author Charlie
 */

import type { WorkspaceRow } from "@/lib/db/workspaces";

export type SandboxResult =
  | { ok: true; abs: string }
  | { ok: false; error: string };

function normLocal(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function normRemote(p: string) {
  const s = p.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!s.startsWith("/")) return `/${s}`.replace(/\/+/g, "/");
  return s.replace(/\/$/, "") || "/";
}

function isWithinRoot(abs: string, root: string, unix: boolean) {
  const a = unix ? normRemote(abs) : normLocal(abs);
  const r = unix ? normRemote(root) : normLocal(root);
  if (a === r) return true;
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return a.startsWith(prefix);
}

/** 将相对或绝对路径解析到本地工作空间根内 */
export function sandboxLocalPath(
  ws: WorkspaceRow,
  inputPath: string,
): SandboxResult {
  const raw = inputPath.trim();
  if (!raw) return { ok: false, error: "path required" };
  if (raw.includes("\0")) return { ok: false, error: "invalid path" };
  const root = normLocal(ws.local_root);
  let abs: string;
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith("/")) {
    abs = normLocal(raw);
  } else {
    abs = normLocal(`${root}/${raw.replace(/^\.?\//, "")}`);
  }
  if (!isWithinRoot(abs, root, false)) {
    return { ok: false, error: `path escapes workspace local root: ${root}` };
  }
  return { ok: true, abs };
}

/** 将相对或绝对路径解析到远程工作空间根内 */
export function sandboxRemotePath(
  ws: WorkspaceRow,
  inputPath: string,
): SandboxResult {
  const raw = inputPath.trim();
  if (!raw) return { ok: false, error: "path required" };
  if (raw.includes("\0")) return { ok: false, error: "invalid path" };
  const root = normRemote(ws.remote_root || "/");
  let abs: string;
  if (raw.startsWith("/")) {
    abs = normRemote(raw);
  } else {
    abs = normRemote(`${root}/${raw.replace(/^\.?\//, "")}`);
  }
  if (!isWithinRoot(abs, root, true)) {
    return { ok: false, error: `path escapes workspace remote root: ${root}` };
  }
  return { ok: true, abs };
}

export function relativeLocalPath(ws: WorkspaceRow, absPath: string): string {
  const root = normLocal(ws.local_root);
  const abs = normLocal(absPath);
  if (abs === root) return ".";
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

export function relativeRemotePath(ws: WorkspaceRow, absPath: string): string {
  const root = normRemote(ws.remote_root || "/");
  const abs = normRemote(absPath);
  if (abs === root) return ".";
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

export function mapLocalToRemote(ws: WorkspaceRow, localAbs: string): string {
  const rel = relativeLocalPath(ws, localAbs);
  const root = normRemote(ws.remote_root || "/");
  if (rel === ".") return root;
  return normRemote(`${root}/${rel}`);
}
