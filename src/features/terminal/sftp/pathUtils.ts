/**
 * @file SFTP 路径与主机显示工具
 * @author Charlie
 * @description 本地/远程路径拼接、上级目录解析，以及主机标题格式化。
 */

import type { HostRow } from "@/lib/db";

/** 判断是否为 Windows 风格路径 */
export function isWindowsPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
}

/** 按本地或远程规则拼接子路径 */
export function joinPath(base: string, name: string, remote: boolean) {
  if (remote) {
    return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
  }
  const sep = base.includes("/") && !base.includes("\\") ? "/" : "\\";
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
