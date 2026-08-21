/**
 * @file 网络测速面板
 * @author Charlie
 * @description 内网测速服务 / 自定义 URL；预热 + 多轮中位数，多连接并行。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  api,
  onNetworkSpeedProgress,
  type SpeedProgress,
  type SpeedServerInfo,
  type SpeedTestResult,
} from "@/lib/tauri";
import { addNetworkHistory } from "@/lib/db";

type PresetId = "intranet" | "custom";

function urlsFromBase(base: string) {
  const b = base.replace(/\/+$/, "");
  return {
    downloadUrl: `${b}/__down?bytes={bytes}`,
    uploadUrl: `${b}/__up`,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm" title={value}>
        {value}
      </div>
    </div>
  );
}

function fmtMbps(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v < 10 ? v.toFixed(2) : v.toFixed(1);
}

function fmtMs(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

/** 网络测速主面板 */
export function SpeedTestPanel() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PresetId>("custom");
  const [advanced, setAdvanced] = useState(true);
  const [intranetBase, setIntranetBase] = useState("http://127.0.0.1:19888");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [uploadUrl, setUploadUrl] = useState("");
  const [downloadMb, setDownloadMb] = useState(50);
  const [uploadMb, setUploadMb] = useState(20);
  const [concurrency, setConcurrency] = useState(4);
  const [rounds, setRounds] = useState(3);
  const [server, setServer] = useState<SpeedServerInfo | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [round, setRound] = useState<number | undefined>();
  const [roundsTotal, setRoundsTotal] = useState(3);
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [mbps, setMbps] = useState<number | undefined>();
  const [bytesDone, setBytesDone] = useState(0);
  const [bytesTotal, setBytesTotal] = useState(0);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ i: number; mbps: number }[]>([]);
  const jobRef = useRef<string | null>(null);
  const sampleIdx = useRef(0);

  useEffect(() => {
    api.networkSpeedServerStatus()
      .then(setServer)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onNetworkSpeedProgress((p: SpeedProgress) => {
      if (disposed) return;
      if (jobRef.current && p.jobId !== jobRef.current) return;
      setPhase(p.phase);
      if (p.round != null) setRound(p.round);
      if (p.rounds != null) setRoundsTotal(p.rounds);
      if (p.latencyMs != null) setLatencyMs(p.latencyMs);
      if (p.mbps != null) setMbps(p.mbps);
      if (p.bytesDone != null) setBytesDone(p.bytesDone);
      if (p.bytesTotal != null) setBytesTotal(p.bytesTotal);
      if (
        (p.phase === "download" || p.phase === "warmup") &&
        p.mbps != null
      ) {
        sampleIdx.current += 1;
        setSamples((prev) => {
          const next = [...prev, { i: sampleIdx.current, mbps: p.mbps! }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
      if (p.phase === "done" && p.result) {
        setResult(p.result);
        setBusy(false);
        jobRef.current = null;
        void addNetworkHistory(
          "speed",
          preset,
          `↓${fmtMbps(p.result.downloadMbps)} ↑${fmtMbps(p.result.uploadMbps)} ${fmtMs(p.result.latencyMs)} ×${p.result.rounds}`,
        );
      }
      if (p.phase === "error") {
        setError(
          p.message === "cancelled"
            ? t("network.speedCancelled")
            : p.message || t("network.speedFailed"),
        );
        setBusy(false);
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
  }, [preset, t]);

  const progressPct = useMemo(() => {
    if (!bytesTotal) return 0;
    return Math.min(100, (bytesDone / bytesTotal) * 100);
  }, [bytesDone, bytesTotal]);

  const phaseLabel = useMemo(() => {
    if (phase === "latency") return t("network.speedPhaseLatency");
    if (phase === "warmup") return t("network.speedPhaseWarmup");
    if (phase === "download") return t("network.speedPhaseDownload");
    if (phase === "upload") return t("network.speedPhaseUpload");
    if (busy) return t("network.speedRunning");
    return null;
  }, [phase, busy, t]);

  const applyIntranetBase = (base: string) => {
    setIntranetBase(base);
    const u = urlsFromBase(base);
    setDownloadUrl(u.downloadUrl);
    setUploadUrl(u.uploadUrl);
  };

  const onPreset = (id: PresetId) => {
    setPreset(id);
    if (id === "intranet") {
      applyIntranetBase(intranetBase);
      setAdvanced(true);
    }
  };

  const startServer = async () => {
    setServerBusy(true);
    setError(null);
    try {
      const info = await api.networkSpeedServerStart(19888);
      setServer(info);
      const local =
        info.baseUrls.find((u) => u.includes("127.0.0.1")) ?? info.baseUrls[0];
      if (local) {
        setPreset("intranet");
        applyIntranetBase(local);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setServerBusy(false);
    }
  };

  const stopServer = async () => {
    setServerBusy(true);
    try {
      await api.networkSpeedServerStop();
      setServer(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setServerBusy(false);
    }
  };

  const start = async () => {
    setError(null);
    setResult(null);
    setSamples([]);
    sampleIdx.current = 0;
    setLatencyMs(undefined);
    setMbps(undefined);
    setBytesDone(0);
    setBytesTotal(0);
    setPhase(null);
    setRound(undefined);
    setBusy(true);
    const dl =
      preset === "intranet"
        ? urlsFromBase(intranetBase).downloadUrl
        : downloadUrl.trim();
    const ul =
      preset === "intranet"
        ? urlsFromBase(intranetBase).uploadUrl
        : uploadUrl.trim();
    try {
      const id = await api.networkSpeedTest({
        downloadUrl: dl,
        uploadUrl: ul,
        downloadBytes: Math.round(downloadMb * 1024 * 1024),
        uploadBytes: Math.round(uploadMb * 1024 * 1024),
        concurrency,
        rounds,
      });
      jobRef.current = id;
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!jobRef.current) return;
    const id = jobRef.current;
    setBusy(false);
    setError(t("network.speedCancelled"));
    await api.networkCancel(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40 space-y-1.5">
          <Label>{t("network.speedPreset")}</Label>
          <Select
            value={preset}
            onValueChange={(v) => onPreset(v as PresetId)}
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="intranet">
                {t("network.speedIntranet")}
              </SelectItem>
              <SelectItem value="custom">{t("network.speedCustom")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-24 space-y-1.5">
          <Label>{t("network.speedConcurrency")}</Label>
          <Input
            className="h-8"
            type="number"
            min={1}
            max={8}
            disabled={busy}
            value={concurrency}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                setConcurrency(Math.min(8, Math.max(1, Math.floor(n))));
              }
            }}
          />
        </div>
        <div className="w-24 space-y-1.5">
          <Label>{t("network.speedRounds")}</Label>
          <Input
            className="h-8"
            type="number"
            min={1}
            max={5}
            disabled={busy}
            value={rounds}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                setRounds(Math.min(5, Math.max(1, Math.floor(n))));
              }
            }}
          />
        </div>
        {!busy ? (
          <Button className="h-8" onClick={start}>
            {t("network.speedStart")}
          </Button>
        ) : (
          <Button className="h-8" variant="destructive" onClick={stop}>
            {t("network.speedStop")}
          </Button>
        )}
        <Button
          type="button"
          className="h-8"
          variant="ghost"
          onClick={() => setAdvanced((v) => !v)}
        >
          {t("network.speedAdvanced")}
          <ChevronDown
            size={14}
            className={cn("transition-transform", advanced && "rotate-180")}
          />
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t("network.speedMedianHint")}
      </p>

      {preset === "intranet" && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            {t("network.speedIntranetHint")}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label>{t("network.speedIntranetBase")}</Label>
              <Input
                className="h-8 font-mono text-xs"
                disabled={busy}
                value={intranetBase}
                onChange={(e) => applyIntranetBase(e.target.value)}
                placeholder="http://192.168.1.10:19888"
              />
            </div>
            {!server ? (
              <Button
                className="h-8"
                variant="outline"
                disabled={serverBusy}
                onClick={startServer}
              >
                {t("network.speedServerStart")}
              </Button>
            ) : (
              <Button
                className="h-8"
                variant="outline"
                disabled={serverBusy}
                onClick={stopServer}
              >
                {t("network.speedServerStop")}
              </Button>
            )}
          </div>
          {server && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                {t("network.speedServerRunning")} · :{server.port}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("network.speedServerUrls")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {server.baseUrls.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] hover:bg-accent"
                    title={t("network.speedUseUrl")}
                    onClick={() => applyIntranetBase(u)}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {advanced && (
        <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("network.speedDownloadUrl")}</Label>
            <Input
              className="h-8 font-mono text-xs"
              disabled={busy || preset === "intranet"}
              value={
                preset === "intranet"
                  ? urlsFromBase(intranetBase).downloadUrl
                  : downloadUrl
              }
              onChange={(e) => {
                setPreset("custom");
                setDownloadUrl(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("network.speedUploadUrl")}</Label>
            <Input
              className="h-8 font-mono text-xs"
              disabled={busy || preset === "intranet"}
              value={
                preset === "intranet"
                  ? urlsFromBase(intranetBase).uploadUrl
                  : uploadUrl
              }
              onChange={(e) => {
                setPreset("custom");
                setUploadUrl(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("network.speedDownloadSize")}</Label>
            <Input
              className="h-8"
              type="number"
              min={1}
              max={200}
              disabled={busy}
              value={downloadMb}
              onChange={(e) => setDownloadMb(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("network.speedUploadSize")}</Label>
            <Input
              className="h-8"
              type="number"
              min={1}
              max={200}
              disabled={busy}
              value={uploadMb}
              onChange={(e) => setUploadMb(Number(e.target.value) || 1)}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label={t("network.speedLatency")}
          value={fmtMs(result?.latencyMs ?? latencyMs)}
        />
        <Stat
          label={t("network.speedDownload")}
          value={`${fmtMbps(result?.downloadMbps ?? (phase === "download" ? mbps : undefined))} ${t("network.speedMbps")}`}
        />
        <Stat
          label={t("network.speedUpload")}
          value={`${fmtMbps(result?.uploadMbps ?? (phase === "upload" ? mbps : undefined))} ${t("network.speedMbps")}`}
        />
      </div>

      {(busy || phase) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {phaseLabel}
              {round != null &&
                roundsTotal > 0 &&
                (phase === "download" ||
                  phase === "upload" ||
                  phase === "warmup") && (
                  <span className="ml-2">
                    {t("network.speedRoundOf", {
                      round: round === 0 ? "W" : round,
                      total: roundsTotal,
                    })}
                  </span>
                )}
            </span>
            {mbps != null && busy && (
              <span className="font-mono">
                {fmtMbps(mbps)} {t("network.speedMbps")}
              </span>
            )}
          </div>
          {(phase === "download" ||
            phase === "upload" ||
            phase === "warmup") && <Progress value={progressPct} />}
        </div>
      )}

      <div className="min-h-[180px] flex-1 rounded-md border border-border bg-card p-2">
        {samples.length < 2 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-sm text-muted-foreground">
            {busy ? t("network.speedRunning") : t("network.speedEmpty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={160}>
            <LineChart
              data={samples}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis dataKey="i" hide />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                unit="M"
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value) => [
                  `${Number(value).toFixed(2)} Mbps`,
                  t("network.speedDownload"),
                ]}
              />
              <Line
                type="monotone"
                dataKey="mbps"
                stroke="var(--primary)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
