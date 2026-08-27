/**
 * @file Ping 连通性页面（独立状态）
 * @author Charlie
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addNetworkHistory } from "@/lib/db";
import { api, onNetworkToolOutput } from "@/lib/tauri";
import { PingViz } from "./PingViz";
import { RawLog } from "./RawLog";
import { type PingSample, type PingSummary, pushPingSample } from "./types";

/** Ping：原文 + 延迟可视化，状态与其它模式隔离 */
export function PingPage() {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
  const [count, setCount] = useState<number | null>(4);
  const [countText, setCountText] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [samples, setSamples] = useState<PingSample[]>([]);
  const [summary, setSummary] = useState<PingSummary | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onNetworkToolOutput((p) => {
      if (disposed) return;
      if (!jobRef.current || p.jobId !== jobRef.current) return;
      if (p.line) setLines((prev) => [...prev, p.line]);
      const ev = p.event;
      if (ev?.kind === "ping_sample") {
        setSamples((prev) =>
          pushPingSample(prev, {
            seq: ev.seq ?? prev.length + 1,
            rttMs: ev.lost ? null : (ev.rttMs ?? null),
            at: Date.now(),
          }),
        );
      } else if (ev?.kind === "ping_summary") {
        setSummary((prev) => ({
          minMs: ev.minMs ?? prev?.minMs,
          avgMs: ev.avgMs ?? prev?.avgMs,
          maxMs: ev.maxMs ?? prev?.maxMs,
          lossPct: ev.lossPct ?? prev?.lossPct,
          sent: ev.sent ?? prev?.sent,
          recv: ev.recv ?? prev?.recv,
        }));
      }
      if (p.done) {
        setBusy(false);
        setJobId(null);
        jobRef.current = null;
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const clear = () => {
    setLines([]);
    setSamples([]);
    setSummary(null);
  };

  const start = async () => {
    const host = target.trim();
    if (!host) return;
    clear();
    setBusy(true);
    try {
      const effectiveCount =
        countText.trim() === "" ? 4 : count === null ? 0 : count;
      const id = await api.networkPing(host, effectiveCount);
      jobRef.current = id;
      setJobId(id);
      await addNetworkHistory("ping", host);
    } catch (e) {
      setLines([String(e)]);
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!jobId) return;
    await api.networkCancel(jobId);
    setBusy(false);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="ping-target">{t("network.host")}</Label>
          <Input
            id="ping-target"
            className="h-8"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder={t("network.hostPlaceholder")}
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor="ping-count">{t("network.count")}</Label>
          <Input
            id="ping-count"
            className="h-8"
            inputMode="numeric"
            placeholder={t("network.countInfinite")}
            title={t("network.countHint")}
            value={countText}
            onChange={(e) => {
              const raw = e.target.value.trim();
              setCountText(e.target.value);
              if (raw === "" || raw === "∞" || raw === "0") {
                setCount(null);
                return;
              }
              const n = Number(raw);
              if (Number.isFinite(n) && n > 0) {
                setCount(Math.min(100, Math.floor(n)));
              }
            }}
            onBlur={() => {
              setCountText(count === null ? "" : String(count));
            }}
          />
        </div>
        {!busy ? (
          <Button className="h-8" onClick={start}>
            {t("network.start")}
          </Button>
        ) : (
          <Button className="h-8" variant="destructive" onClick={stop}>
            {t("network.stop")}
          </Button>
        )}
        <Button
          className="h-8"
          variant="outline"
          onClick={clear}
          disabled={busy}
        >
          {t("network.clear")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-[3] flex-col">
          <RawLog lines={lines} busy={busy} />
        </div>
        <div className="flex min-h-0 flex-[2] flex-col overflow-hidden">
          <PingViz samples={samples} summary={summary} busy={busy} />
        </div>
      </div>
    </div>
  );
}
