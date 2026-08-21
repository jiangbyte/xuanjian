/**
 * @file 会话日志详情与回放
 * @author Charlie
 * @description 只读 xterm 回放会话输出，支持时间轴播放、倍速、导出 cast/纯文本。
 * 写入路径经单飞 dump 避免异步 term.write 重叠导致内容翻倍。
 */

import { save } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ArrowLeft, Download, Gauge, Pin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  type ContextMenuItem,
  openContextMenu,
  useContextMenu,
} from "@/components/ContextMenu";
import { Button } from "@/components/ui/button";
import { LogPlaybackBar } from "@/features/logs/LogPlaybackBar";
import {
  buildAsciinemaCast,
  buildPlainLog,
  formatBytes,
  formatLogTimeRange,
} from "@/features/logs/logExport";
import { clipboardWriteText } from "@/lib/clipboard";
import { modKeyLabel } from "@/lib/platform";
import {
  getSessionLog,
  listSessionLogChunks,
  SessionLogChunkRow,
  SessionLogRow,
  setSessionLogPinned,
} from "@/lib/db";
import { dialogs } from "@/lib/dialogs";
import { api } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings";

/** 单条会话日志的只读终端详情页 */
export function LogDetailView() {
  const { id } = useParams();
  const logId = Number(id);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { open: openMenu } = useContextMenu();
  const termFontSize = useSettingsStore((s) => s.termFontSize);
  const termFontFamily = useSettingsStore((s) => s.termFontFamily);

  const [log, setLog] = useState<SessionLogRow | null>(null);
  const [outChunks, setOutChunks] = useState<SessionLogChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [termReady, setTermReady] = useState(0);
  const [playbackMode, setPlaybackMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [cursor, setCursor] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const cursorRef = useRef(0);
  const chunksRef = useRef<SessionLogChunkRow[]>([]);
  const dumpGenRef = useRef(0);

  playingRef.current = playing;
  speedRef.current = speed;
  cursorRef.current = cursor;
  chunksRef.current = outChunks;

  const durationMs = useMemo(() => {
    if (outChunks.length === 0) return 0;
    return outChunks[outChunks.length - 1]?.t_ms ?? 0;
  }, [outChunks]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** 单飞 dump：xterm.write 异步，重叠 dump 会导致内容翻倍 */
  const dumpAll = useCallback(() => {
    clearTimer();
    setPlaying(false);
    const term = termRef.current;
    const chunks = chunksRef.current;
    const n = chunks.length;
    setCursor(n);
    setCurrentMs(chunks[n - 1]?.t_ms ?? 0);
    cursorRef.current = n;
    if (!term) return;

    const gen = ++dumpGenRef.current;
    term.reset();
    if (n <= 0) return;

    let i = 0;
    const step = () => {
      if (gen !== dumpGenRef.current || termRef.current !== term) return;
      if (i >= n) return;
      let buf = "";
      const end = Math.min(n, i + 40);
      while (i < end) {
        buf += chunks[i].data;
        i += 1;
      }
      term.write(buf, () => {
        if (gen !== dumpGenRef.current) return;
        if (i < n) step();
      });
    };
    step();
  }, []);

  const writeUpToIndex = useCallback((endExclusive: number) => {
    const term = termRef.current;
    if (!term) return;
    dumpGenRef.current += 1;
    const gen = dumpGenRef.current;
    term.reset();
    const chunks = chunksRef.current;
    if (endExclusive <= 0) return;
    let i = 0;
    const step = () => {
      if (gen !== dumpGenRef.current || termRef.current !== term) return;
      if (i >= endExclusive) return;
      let buf = "";
      const end = Math.min(endExclusive, i + 40);
      while (i < end) {
        buf += chunks[i].data;
        i += 1;
      }
      term.write(buf, () => {
        if (gen !== dumpGenRef.current) return;
        if (i < endExclusive) step();
      });
    };
    step();
  }, []);

  const scheduleNext = useCallback(() => {
    clearTimer();
    if (!playingRef.current) return;
    const chunks = chunksRef.current;
    const i = cursorRef.current;
    if (i >= chunks.length) {
      setPlaying(false);
      return;
    }
    const chunk = chunks[i];
    const prevT = i === 0 ? 0 : chunks[i - 1].t_ms;
    const wait = Math.max(0, (chunk.t_ms - prevT) / speedRef.current);
    timerRef.current = setTimeout(() => {
      const term = termRef.current;
      if (!term) return;
      term.write(chunk.data);
      const next = i + 1;
      setCursor(next);
      setCurrentMs(chunk.t_ms);
      cursorRef.current = next;
      if (next >= chunks.length) {
        setPlaying(false);
        return;
      }
      scheduleNext();
    }, wait);
  }, []);

  useEffect(() => {
    if (!Number.isFinite(logId)) {
      setLoading(false);
      setLog(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPlaybackMode(false);
    setTermReady(0);
    (async () => {
      const row = await getSessionLog(logId);
      if (cancelled) return;
      setLog(row);
      if (!row) {
        setOutChunks([]);
        setLoading(false);
        return;
      }
      const chunks = await listSessionLogChunks(logId, { direction: "out" });
      if (cancelled) return;
      setOutChunks(chunks);
      setLoading(false);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [logId]);

  useEffect(() => {
    if (loading || !log) return;
    const el = containerRef.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      disableStdin: true,
      convertEol: false,
      fontSize: useSettingsStore.getState().termFontSize,
      fontFamily: useSettingsStore.getState().termFontFamily,
      scrollback: 50000,
      rightClickSelectsWord: false,
      theme: {
        background: "#0f1115",
        foreground: "#e8eaed",
        cursor: "#4ea1ff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    const doFit = () => {
      try {
        if (el.clientWidth >= 24 && el.clientHeight >= 24) fit.fit();
      } catch {
        /* ignore */
      }
    };
    requestAnimationFrame(doFit);
    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "c") {
        const text = term.getSelection();
        if (!text) return;
        e.preventDefault();
        e.stopPropagation();
        clipboardWriteText(text).catch(() => undefined);
      }
    };
    el.addEventListener("keydown", onKeyDown, true);

    setTermReady((n) => n + 1);
    return () => {
      dumpGenRef.current += 1;
      clearTimer();
      ro.disconnect();
      el.removeEventListener("keydown", onKeyDown, true);
      term.dispose();
      if (termRef.current === term) termRef.current = null;
      fitRef.current = null;
    };
  }, [loading, log?.id]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = termFontSize;
    term.options.fontFamily = termFontFamily;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [termFontSize, termFontFamily, termReady]);

  useEffect(() => {
    if (!termReady || !termRef.current) return;
    if (playbackMode) {
      clearTimer();
      setPlaying(false);
      setCursor(0);
      setCurrentMs(0);
      cursorRef.current = 0;
      dumpGenRef.current += 1;
      termRef.current.reset();
      return;
    }
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
    dumpAll();
  }, [termReady, outChunks, playbackMode, dumpAll]);

  useEffect(() => {
    if (!playbackMode) return;
    if (playing) scheduleNext();
    else clearTimer();
    return () => clearTimer();
  }, [playing, speed, playbackMode, scheduleNext]);

  const seekTo = (ms: number) => {
    clearTimer();
    const chunks = chunksRef.current;
    let idx = 0;
    while (idx < chunks.length && chunks[idx].t_ms <= ms) idx += 1;
    writeUpToIndex(idx);
    setCursor(idx);
    setCurrentMs(ms);
    cursorRef.current = idx;
    if (playingRef.current) {
      setTimeout(() => scheduleNext(), 0);
    }
  };

  const copySelection = () => {
    const text = termRef.current?.getSelection() || "";
    if (!text) return;
    clipboardWriteText(text).catch(() => undefined);
  };

  const exportFile = async (kind: "log" | "cast") => {
    if (!log) return;
    const defaultPath =
      kind === "cast"
        ? `${sanitizeName(log.title)}.cast`
        : `${sanitizeName(log.title)}.log`;
    const path = await save({
      defaultPath,
      filters:
        kind === "cast"
          ? [{ name: "Asciinema", extensions: ["cast"] }]
          : [{ name: "Log", extensions: ["log", "txt"] }],
    });
    if (!path) return;
    const body =
      kind === "cast"
        ? buildAsciinemaCast(log, outChunks, {
            width: termRef.current?.cols,
            height: termRef.current?.rows,
          })
        : buildPlainLog(outChunks);
    try {
      await api.writeLocalFile(path, body);
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  if (!Number.isFinite(logId)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("logs.notFound")}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("logs.loading")}
      </div>
    );
  }

  if (!log) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("logs.notFound")}
      </div>
    );
  }

  const meta =
    log.kind === "ssh"
      ? `${log.remote_user || "?"}@${log.remote_host || "?"}`
      : t("logs.kindLocal");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("logs.back")}
            onClick={() => navigate("/logs")}
          >
            <ArrowLeft size={16} />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{log.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {formatLogTimeRange(log.started_at, log.ended_at, t("logs.live"))}{" "}
              · {meta} · {formatBytes(log.bytes_out)} · {t("logs.readonly")}
            </div>
          </div>
          <Button
            size="xs"
            variant={playbackMode ? "default" : "outline"}
            title={t("logs.playbackToggle")}
            onClick={() => setPlaybackMode((v) => !v)}
          >
            <Gauge size={14} />
            {playbackMode ? t("logs.playbackOn") : t("logs.playback")}
          </Button>
          <Button
            variant={log.pinned ? "default" : "ghost"}
            size="icon-sm"
            title={t("logs.pin")}
            onClick={async () => {
              const next = !log.pinned;
              await setSessionLogPinned(log.id, next);
              setLog({ ...log, pinned: next ? 1 : 0 });
            }}
          >
            <Pin size={16} />
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => exportFile("log").catch(console.error)}
          >
            <Download size={14} />
            {t("logs.exportLog")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => exportFile("cast").catch(console.error)}
          >
            <Download size={14} />
            {t("logs.exportCast")}
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-background p-2"
        onContextMenu={(e) => {
          const term = termRef.current;
          const hasSelection = !!(term && term.hasSelection());
          const items: ContextMenuItem[] = [
            {
              id: "copy",
              label: t("context.copy", { mod: modKeyLabel() }),
              disabled: !hasSelection,
              onClick: () => copySelection(),
            },
          ];
          openContextMenu(e, openMenu, items);
        }}
      />
      {playbackMode ? (
        <LogPlaybackBar
          playing={playing}
          speed={speed}
          currentMs={currentMs}
          durationMs={durationMs}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSpeedChange={setSpeed}
          onSeek={seekTo}
          onInstant={dumpAll}
        />
      ) : null}
    </div>
  );
}

/** 将标题整理为可作文件名的安全字符串 */
function sanitizeName(name: string) {
  return name.replace(/[<>:"/\\|?*]+/g, "_").slice(0, 80) || "session";
}
