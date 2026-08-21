/**
 * @file 日志回放控制条
 * @author Charlie
 * @description 提供播放/暂停、瞬时跳到末尾、进度 scrub 与倍速选择。
 * 由日志详情页在回放模式下挂载。
 */

import { useTranslation } from "react-i18next";
import { FastForward, Pause, Play, SkipForward } from "lucide-react";
import { formatDurationMs } from "@/features/logs/logExport";

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

/** 会话日志时间轴回放控制栏 */
export function LogPlaybackBar({
  playing,
  speed,
  currentMs,
  durationMs,
  onTogglePlay,
  onSpeedChange,
  onSeek,
  onInstant,
}: {
  playing: boolean;
  speed: number;
  currentMs: number;
  durationMs: number;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (ms: number) => void;
  onInstant: () => void;
}) {
  const { t } = useTranslation();
  const max = Math.max(1, durationMs);
  const pct = Math.min(100, (currentMs / max) * 100);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--panel)] px-4 py-2">
      {/* —— 播放 / 瞬时到末 —— */}
      <button
        type="button"
        className="icon-btn"
        title={playing ? t("logs.pause") : t("logs.play")}
        onClick={onTogglePlay}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("logs.instant")}
        onClick={onInstant}
      >
        <SkipForward size={16} />
      </button>
      {/* —— 进度条 —— */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-12 shrink-0 text-right font-mono text-[11px] muted">
          {formatDurationMs(currentMs)}
        </span>
        <input
          type="range"
          className="h-1.5 w-full accent-[var(--accent)]"
          min={0}
          max={max}
          step={1}
          value={Math.min(currentMs, max)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label={t("logs.scrub")}
        />
        <span className="w-12 shrink-0 font-mono text-[11px] muted">
          {formatDurationMs(durationMs)}
        </span>
      </div>
      {/* —— 倍速 —— */}
      <div className="flex items-center gap-1">
        <FastForward size={14} className="muted" />
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn btn-sm ${speed === s ? "btn-primary" : ""}`}
            onClick={() => onSpeedChange(s)}
          >
            {s}x
          </button>
        ))}
      </div>
      <div className="hidden w-10 text-right text-[10px] muted sm:block">
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}
