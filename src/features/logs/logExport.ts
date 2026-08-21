/**
 * @file 会话日志导出与格式化
 * @author Charlie
 * @description 将输出块组装为 asciinema v2 cast 或纯文本日志，
 * 并提供字节大小、时长、时间范围等展示用格式化函数。
 */

import type { SessionLogChunkRow, SessionLogRow } from "@/lib/db";

/** 由输出块构建 asciinema v2 cast 文件内容 */
export function buildAsciinemaCast(
  log: SessionLogRow,
  outChunks: SessionLogChunkRow[],
  opts?: { width?: number; height?: number },
): string {
  const header = {
    version: 2,
    width: opts?.width ?? 120,
    height: opts?.height ?? 40,
    title: log.title,
    timestamp: Math.floor(new Date(log.started_at).getTime() / 1000),
  };
  const lines: string[] = [JSON.stringify(header)];
  for (const c of outChunks) {
    const sec = (c.t_ms || 0) / 1000;
    lines.push(JSON.stringify([sec, "o", c.data]));
  }
  return `${lines.join("\n")}\n`;
}

/** 将输出块拼接为纯文本日志 */
export function buildPlainLog(outChunks: SessionLogChunkRow[]): string {
  return outChunks.map((c) => c.data).join("");
}

/** 人类可读的字节大小（B / KB / MB） */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 将毫秒格式化为 m:ss 或 h:mm:ss */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 格式化日志起止时间范围。
 * 无结束时间时用 liveLabel（如「进行中」）占位。
 */
export function formatLogTimeRange(
  startedAt: string,
  endedAt: string | null,
  liveLabel: string,
): string {
  const start = formatClock(startedAt);
  if (!endedAt) return `${start} – ${liveLabel}`;
  return `${start} – ${formatClock(endedAt)}`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}
