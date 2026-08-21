/**
 * @file 日志回放控制条
 * @author Charlie
 * @description 提供播放/暂停、瞬时跳到末尾、进度 scrub 与倍速选择。
 * 由日志详情页在回放模式下挂载。
 */

import { FastForward, Pause, Play, SkipForward } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        title={playing ? t("logs.pause") : t("logs.play")}
        onClick={onTogglePlay}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t("logs.instant")}
        onClick={onInstant}
      >
        <SkipForward size={16} />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
          {formatDurationMs(currentMs)}
        </span>
        <input
          type="range"
          className="h-1.5 w-full accent-primary"
          min={0}
          max={max}
          step={1}
          value={Math.min(currentMs, max)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label={t("logs.scrub")}
        />
        <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
          {formatDurationMs(durationMs)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <FastForward size={14} className="text-muted-foreground" />
        {SPEEDS.map((s) => (
          <Button
            key={s}
            size="xs"
            variant={speed === s ? "default" : "outline"}
            onClick={() => onSpeedChange(s)}
          >
            {s}x
          </Button>
        ))}
      </div>
      <div className="hidden w-10 text-right text-xs text-muted-foreground sm:block">
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}
