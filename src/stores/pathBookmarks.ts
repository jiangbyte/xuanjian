/**
 * @file 路径书签 Store
 * @author Charlie
 * @description 按 scope（local / ssh:hostId）管理路径收藏。
 * 路径规范化后存 localStorage；每 scope 最多 40 条。
 */

import { create } from "zustand";

/** 单条路径书签 */
export type PathBookmark = {
  path: string;
  at: number;
};

type BookmarkState = {
  byScope: Record<string, PathBookmark[]>;
  list: (scope: string) => PathBookmark[];
  has: (scope: string, path: string) => boolean;
  add: (scope: string, path: string) => void;
  remove: (scope: string, path: string) => void;
  toggle: (scope: string, path: string) => boolean;
};

const KEY = "xuanjian.pathBookmarks";
const MAX_PER_SCOPE = 40;

/** 规范化路径（Win 反斜杠 / Unix 去尾斜杠） */
function normPath(path: string) {
  const p = path.trim();
  if (!p) return "";
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.includes("\\")) {
    return p.replace(/\//g, "\\").replace(/\\+$/, "") || p;
  }
  if (p !== "/" && p.endsWith("/")) return p.replace(/\/+$/, "") || "/";
  return p;
}

function load(): Record<string, PathBookmark[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(byScope: Record<string, PathBookmark[]>) {
  localStorage.setItem(KEY, JSON.stringify(byScope));
}

/**
 * 从完整路径提取展示用末级名（盘符或 `/` 特殊处理）。
 */
function bookmarkLabel(path: string) {
  const n = normPath(path);
  if (!n || n === "/") return "/";
  if (/^[a-zA-Z]:\\?$/.test(n)) return n.endsWith("\\") ? n : `${n}\\`;
  const parts = n.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || n;
}

export { bookmarkLabel, normPath };

/**
 * 路径书签 Zustand store。
 * @副作用 add/remove/toggle 持久化到 localStorage
 */
export const usePathBookmarks = create<BookmarkState>((set, get) => ({
  byScope: load(),
  list: (scope) => get().byScope[scope] ?? [],
  has: (scope, path) => {
    const key = normPath(path);
    if (!key) return false;
    return (get().byScope[scope] ?? []).some((b) => normPath(b.path) === key);
  },
  add: (scope, path) => {
    const key = normPath(path);
    if (!key) return;
    const prev = get().byScope[scope] ?? [];
    if (prev.some((b) => normPath(b.path) === key)) return;
    const next = [{ path: key, at: Date.now() }, ...prev].slice(
      0,
      MAX_PER_SCOPE,
    );
    const byScope = { ...get().byScope, [scope]: next };
    save(byScope);
    set({ byScope });
  },
  remove: (scope, path) => {
    const key = normPath(path);
    const prev = get().byScope[scope] ?? [];
    const next = prev.filter((b) => normPath(b.path) !== key);
    const byScope = { ...get().byScope, [scope]: next };
    save(byScope);
    set({ byScope });
  },
  /** @returns 添加后为 true，移除后为 false */
  toggle: (scope, path) => {
    if (get().has(scope, path)) {
      get().remove(scope, path);
      return false;
    }
    get().add(scope, path);
    return true;
  },
}));

/**
 * 根据会话类型与主机 ID 生成书签 scope 键。
 * @param opts.kind local / ssh / host
 * @param opts.hostId SSH 主机主键
 */
export function bookmarkScope(opts: {
  kind: "local" | "ssh" | "host" | "wsl" | null | undefined;
  hostId?: number | null;
  shellId?: string | null;
}) {
  if (opts.kind === "wsl" || opts.shellId?.startsWith("local:wsl:")) {
    const distro = opts.shellId?.replace(/^local:wsl:/, "").trim() || "default";
    return `wsl:${distro}`;
  }
  if (opts.kind === "ssh" || opts.kind === "host") {
    return opts.hostId != null ? `ssh:${opts.hostId}` : "ssh:unknown";
  }
  return "local";
}
