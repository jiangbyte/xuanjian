/**
 * @file SFTP 路径与主机显示工具
 * @author Charlie
 * @description 本地/远程路径拼接、上级目录解析，以及主机标题格式化。
 */

import type { HostRow } from "@/lib/db";
import { getHostOs } from "@/lib/core/platform";

/** 判断是否为 Windows 风格路径 */
export function isWindowsPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

/** 本机路径分隔符（按宿主 OS；远程固定 /） */
export function localPathSep() {
  return getHostOs() === "windows" ? "\\" : "/";
}

/** 按本地或远程规则拼接子路径 */
export function joinPath(base: string, name: string, remote: boolean) {
  if (remote) {
    return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
  }
  // 已有路径形态优先；否则按本机 OS
  const sep = isWindowsPath(base)
    ? "\\"
    : base.includes("/")
      ? "/"
      : localPathSep();
  if (base.endsWith("\\") || base.endsWith("/")) return `${base}${name}`;
  return `${base}${sep}${name}`;
}

/** 解析上级目录路径（兼容 Windows 盘符与 Unix） */
export function parentPath(path: string, remote: boolean) {
  if (remote) {
    const parts = path.replace(/\/+$/, "").split("/");
    parts.pop();
    return parts.length ? parts.join("/") || "/" : "/";
  }
  if (isWindowsPath(path)) {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 1) return `${parts[0] || "C:"}\\`;
    parts.pop();
    const drive = parts[0];
    return parts.length === 1 ? `${drive}\\` : parts.join("\\");
  }
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/** 主机显示标题：优先名称，否则 host */
export function hostTitle(h: HostRow) {
  return h.name || h.host;
}
