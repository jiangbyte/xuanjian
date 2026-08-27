/**
 * @file Traceroute 连通性页面（独立状态）
 * @author Charlie
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addNetworkHistory } from "@/lib/db";
import { api, onNetworkToolOutput } from "@/lib/tauri";
import { RawLog } from "./RawLog";
import { TraceViz } from "./TraceViz";
import { type TraceHop, upsertTraceHop } from "./types";

/** Traceroute：原文 + hop 路径，状态与其它模式隔离 */
export function TracePage() {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [hops, setHops] = useState<TraceHop[]>([]);
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
      if (ev?.kind === "trace_hop" && ev.hop != null) {
        setHops((prev) =>
          upsertTraceHop(prev, {
            hop: ev.hop!,
            host: ev.host,
            ip: ev.ip,
            rtts: ev.rtts ?? (ev.rttMs != null ? [ev.rttMs] : [null]),
          }),
        );
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
    setHops([]);
  };

  const start = async () => {
    const host = target.trim();
    if (!host) return;
    clear();
    setBusy(true);
    try {
      const id = await api.networkTraceroute(host);
      jobRef.current = id;
      setJobId(id);
      await addNetworkHistory("traceroute", host);
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
          <Label htmlFor="trace-target">{t("network.host")}</Label>
          <Input
            id="trace-target"
            className="h-8"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder={t("network.hostPlaceholder")}
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
          <TraceViz hops={hops} busy={busy} target={target} />
        </div>
      </div>
    </div>
  );
}
