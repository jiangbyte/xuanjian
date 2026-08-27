/**
 * @file 网络测速面板
 * @description LibreSpeed 国内高校节点 / 内网两点 / 自定义。
 */

import { ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addNetworkHistory } from "@/lib/db";
import {
  api,
  onNetworkSpeedProgress,
  type SpeedProgress,
  type SpeedServer,
  type SpeedServerInfo,
  type SpeedTestResult,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { SpeedGauge, SpeedLineChart } from "./SpeedCharts";

type ModeId = "internet" | "intranet" | "custom";
type IpVersion = "v4" | "v6";

const DL_COLOR = "#0ea5c4";
const UL_COLOR = "#ec4899";

function urlsFromBase(base: string) {
  const b = base.replace(/\/+$/, "");
  return {
    downloadUrl: `${b}/__down?bytes={bytes}`,
    uploadUrl: `${b}/__up`,
  };
}

function serverLabel(s: SpeedServer) {
  const tag = s.ipv6 ? "IPv6" : "IPv4";
  return `${s.name} · ${s.location}（${tag}）`;
}

function fmtMbps(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v < 10 ? v.toFixed(2) : v.toFixed(1);
}

function fmtMs(v: number | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

function isDownloadPhase(phase: string) {
  return phase === "download" || phase === "warmup_download";
}

function isUploadPhase(phase: string) {
  return phase === "upload" || phase === "warmup_upload";
}

function isMeasuredDownloadPhase(phase: string) {
  return phase === "download";
}

function isMeasuredUploadPhase(phase: string) {
  return phase === "upload";
}

/** 网络测速主面板 */
export function SpeedTestPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ModeId>("internet");
  const [ipVersion, setIpVersion] = useState<IpVersion>("v4");
  const [servers, setServers] = useState<SpeedServer[]>([]);
  const [serverId, setServerId] = useState("auto");
  const [activeServer, setActiveServer] = useState<SpeedServer | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [intranetBase, setIntranetBase] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [uploadUrl, setUploadUrl] = useState("");
  const [latencyUrl, setLatencyUrl] = useState("");
  const [downloadMb, setDownloadMb] = useState(20);
  const [uploadMb, setUploadMb] = useState(8);
  const [concurrency, setConcurrency] = useState(4);
  const [rounds, setRounds] = useState(1);
  const [server, setServer] = useState<SpeedServerInfo | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [jitterMs, setJitterMs] = useState<number | undefined>();
  const [dlMbps, setDlMbps] = useState(0);
  const [ulMbps, setUlMbps] = useState(0);
  const [peakDl, setPeakDl] = useState(0);
  const [peakUl, setPeakUl] = useState(0);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlSamples, setDlSamples] = useState<{ i: number; mbps: number }[]>([]);
  const [ulSamples, setUlSamples] = useState<{ i: number; mbps: number }[]>([]);
  const jobRef = useRef<string | null>(null);
  const runGenRef = useRef(0);
  const busyRef = useRef(false);
  const sampleIdx = useRef(0);

  const ipv6 = ipVersion === "v6";

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const loadServers = useCallback(async () => {
    try {
      const list = await api.networkSpeedListNodes(ipv6);
      setServers(list);
    } catch (e) {
      setError(String(e));
    }
  }, [ipv6]);

  useEffect(() => {
    api
      .networkSpeedServerStatus()
      .then(setServer)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode === "internet") void loadServers();
  }, [mode, loadServers]);

  useEffect(() => {
    setServerId("auto");
    setActiveServer(null);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onNetworkSpeedProgress((p: SpeedProgress) => {
      if (disposed) return;
      if (!busyRef.current) return;
      if (jobRef.current) {
        if (p.jobId !== jobRef.current) return;
      } else {
        jobRef.current = p.jobId;
      }
      setPhase(p.phase);
      if (p.latencyMs != null) setLatencyMs(p.latencyMs);
      if (p.jitterMs != null) setJitterMs(p.jitterMs);
      if (p.mbps != null) {
        if (isDownloadPhase(p.phase)) {
          setDlMbps(p.mbps);
          setPeakDl((prev) => Math.max(prev, p.mbps!));
          if (isMeasuredDownloadPhase(p.phase)) {
            sampleIdx.current += 1;
            setDlSamples((prev) => {
              const next = [...prev, { i: sampleIdx.current, mbps: p.mbps! }];
              return next.length > 120 ? next.slice(-120) : next;
            });
          }
        }
        if (isUploadPhase(p.phase)) {
          setUlMbps(p.mbps);
          setPeakUl((prev) => Math.max(prev, p.mbps!));
          if (isMeasuredUploadPhase(p.phase)) {
            sampleIdx.current += 1;
            setUlSamples((prev) => {
              const next = [...prev, { i: sampleIdx.current, mbps: p.mbps! }];
              return next.length > 120 ? next.slice(-120) : next;
            });
          }
        }
      }
      if (p.phase === "done" && p.result) {
        setResult(p.result);
        setDlMbps(p.result.downloadMbps);
        setUlMbps(p.result.uploadMbps);
        setPeakDl(p.result.downloadMbps);
        setPeakUl(p.result.uploadMbps);
        setBusy(false);
        jobRef.current = null;
        const label =
          mode === "internet"
            ? activeServer
              ? serverLabel(activeServer)
              : t("network.speedInternet")
            : mode;
        void addNetworkHistory(
          "speed",
          label,
          `↓${fmtMbps(p.result.downloadMbps)} ↑${fmtMbps(p.result.uploadMbps)} ${fmtMs(p.result.latencyMs)}`,
        );
      }
      if (p.phase === "error") {
        if (p.message === "cancelled") {
          if (jobRef.current === p.jobId) {
            setBusy(false);
            jobRef.current = null;
          }
          return;
        }
        setError(p.message || t("network.speedFailed"));
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
  }, [activeServer, mode, t]);

  const phaseHint = useMemo(() => {
    if (phase === "preparing") return t("network.speedPhasePreparing");
    if (phase === "picking") return t("network.speedPhasePickingNode");
    if (phase === "starting") return t("network.speedPhaseStarting");
    if (phase === "latency") return t("network.speedPhaseLatency");
    if (phase === "warmup_download") return t("network.speedPhaseWarmup");
    if (phase === "warmup_upload") return t("network.speedPhaseWarmup");
    if (phase === "download") return t("network.speedPhaseDownload");
    if (phase === "upload") return t("network.speedPhaseUpload");
    if (busy) return t("network.speedRunning");
    return null;
  }, [phase, busy, t]);

  const resetRunState = useCallback(() => {
    setBusy(false);
    setPhase(null);
    setLatencyMs(undefined);
    setJitterMs(undefined);
    setDlMbps(0);
    setUlMbps(0);
    setPeakDl(0);
    setPeakUl(0);
    jobRef.current = null;
  }, []);

  const applyIntranetBase = (base: string) => {
    setIntranetBase(base);
    const u = urlsFromBase(base);
    setDownloadUrl(u.downloadUrl);
    setUploadUrl(u.uploadUrl);
    setLatencyUrl("");
  };

  const startLocalServer = async () => {
    setServerBusy(true);
    setError(null);
    try {
      const info = await api.networkSpeedServerStart(19888);
      setServer(info);
      const local =
        info.baseUrls.find((u) => u.includes("127.0.0.1")) ?? info.baseUrls[0];
      if (local) {
        setMode("intranet");
        applyIntranetBase(local);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setServerBusy(false);
    }
  };

  const stopLocalServer = async () => {
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

  const resolveUrls = async (
    gen: number,
    onPhase: (p: string) => void,
  ): Promise<{ dl: string; ul: string; ping?: string }> => {
    if (mode === "intranet") {
      const base = intranetBase.trim();
      if (!base) throw new Error(t("network.speedIntranetBaseRequired"));
      const u = urlsFromBase(base);
      return { dl: u.downloadUrl, ul: u.uploadUrl };
    }
    if (mode === "custom") {
      const dl = downloadUrl.trim();
      const ul = uploadUrl.trim();
      if (!dl || !ul) throw new Error(t("network.speedUrlRequired"));
      return { dl, ul, ping: latencyUrl.trim() || undefined };
    }
    if (serverId !== "auto") {
      const s = servers.find((n) => n.id === serverId);
      if (!s) throw new Error(t("network.speedFailed"));
      if (gen !== runGenRef.current) throw new Error("cancelled");
      setActiveServer(s);
      return { dl: s.downloadUrl, ul: s.uploadUrl, ping: s.pingUrl };
    }
    onPhase("picking");
    const s = await api.networkSpeedPickNode(ipv6, null);
    if (gen !== runGenRef.current) throw new Error("cancelled");
    setActiveServer(s);
    return { dl: s.downloadUrl, ul: s.uploadUrl, ping: s.pingUrl };
  };

  const start = async () => {
    const gen = ++runGenRef.current;
    setError(null);
    setResult(null);
    setDlSamples([]);
    setUlSamples([]);
    sampleIdx.current = 0;
    setLatencyMs(undefined);
    setJitterMs(undefined);
    setDlMbps(0);
    setUlMbps(0);
    setPeakDl(0);
    setPeakUl(0);
    setPhase("preparing");
    setBusy(true);
    try {
      const { dl, ul, ping } = await resolveUrls(gen, setPhase);
      if (gen !== runGenRef.current) return;
      const id = await api.networkSpeedTest({
        downloadUrl: dl,
        uploadUrl: ul,
        latencyUrl: ping ?? null,
        downloadBytes: Math.round(downloadMb * 1024 * 1024),
        uploadBytes: Math.round(uploadMb * 1024 * 1024),
        concurrency,
        rounds,
      });
      if (gen !== runGenRef.current) {
        void api.networkCancel(id);
        return;
      }
      jobRef.current = id;
    } catch (e) {
      if (gen !== runGenRef.current) return;
      const msg = String(e);
      if (msg !== "cancelled" && msg !== "Error: cancelled") {
        setError(msg);
      }
      resetRunState();
    }
  };

  const stop = () => {
    runGenRef.current += 1;
    const id = jobRef.current;
    resetRunState();
    setError(null);
    if (id) void api.networkCancel(id);
  };

  const displayDl = useMemo(() => {
    if (result) return result.downloadMbps;
    if (isUploadPhase(phase ?? "") || peakUl > 0) {
      return Math.max(peakDl, dlMbps);
    }
    return dlMbps;
  }, [result, phase, peakDl, peakUl, dlMbps]);

  const displayUl = useMemo(() => {
    if (result) return result.uploadMbps;
    if (isUploadPhase(phase ?? "")) return ulMbps;
    return peakUl;
  }, [result, phase, ulMbps, peakUl]);

  const gaugeMaxScale = useMemo(
    () => Math.max(displayDl, displayUl, peakDl, peakUl, 1),
    [displayDl, displayUl, peakDl, peakUl],
  );

  const dlGaugeActive = busy && isDownloadPhase(phase ?? "");
  const ulGaugeActive = busy && isUploadPhase(phase ?? "");
  const displayLat = result?.latencyMs ?? latencyMs;
  const displayJit = result?.jitterMs ?? jitterMs;

  const modeHint =
    mode === "internet"
      ? t("network.speedInternetHint")
      : mode === "intranet"
        ? t("network.speedIntranetHint")
        : t("network.speedCustomHint");

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-3",
        !embedded && "p-4",
      )}
    >
      {/* 配置区 */}
      <div className="shrink-0 space-y-2.5 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[8.5rem] shrink-0 space-y-1">
            <Label className="text-xs">{t("network.speedMode")}</Label>
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v as ModeId);
                setError(null);
              }}
              disabled={busy}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internet">
                  {t("network.speedInternet")}
                </SelectItem>
                <SelectItem value="intranet">
                  {t("network.speedIntranetPeer")}
                </SelectItem>
                <SelectItem value="custom">
                  {t("network.speedCustom")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "internet" && (
            <div className="w-[5.75rem] shrink-0 space-y-1">
              <Label className="text-xs">{t("network.speedIpVersion")}</Label>
              <div className="inline-flex h-8 w-full overflow-hidden rounded-md border border-input">
                {(["v4", "v6"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    className={cn(
                      "h-full flex-1 text-xs transition-colors",
                      ipVersion === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                    onClick={() => setIpVersion(v)}
                  >
                    {v === "v4"
                      ? t("network.speedIpv4")
                      : t("network.speedIpv6")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 主输入槽：互联网节点 / 内网地址 / 自定义上下传 URL，宽度固定便于模式切换 */}
          <div className="min-w-[12rem] flex-1 space-y-1">
            {mode === "internet" && (
              <>
                <Label className="text-xs">{t("network.speedNodeAuto")}</Label>
                <Select
                  value={serverId}
                  onValueChange={setServerId}
                  disabled={busy}
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {t("network.speedNodeAuto")}
                    </SelectItem>
                    {servers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {serverLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {mode === "intranet" && (
              <>
                <Label className="text-xs">
                  {t("network.speedIntranetBase")}
                </Label>
                <Input
                  className="h-8 font-mono text-xs"
                  disabled={busy}
                  value={intranetBase}
                  onChange={(e) => applyIntranetBase(e.target.value)}
                  placeholder={t("network.speedIntranetPlaceholder")}
                />
              </>
            )}

            {mode === "custom" && (
              <>
                <Label className="text-xs">
                  {t("network.speedCustomUrls")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    disabled={busy}
                    value={downloadUrl}
                    onChange={(e) => setDownloadUrl(e.target.value)}
                    placeholder={t("network.speedDownloadUrl")}
                  />
                  <Input
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    disabled={busy}
                    value={uploadUrl}
                    onChange={(e) => setUploadUrl(e.target.value)}
                    placeholder={t("network.speedUploadUrl")}
                  />
                </div>
              </>
            )}
          </div>

          {mode === "intranet" &&
            (!server ? (
              <Button
                className="h-8 shrink-0"
                variant="outline"
                disabled={serverBusy}
                onClick={startLocalServer}
              >
                {t("network.speedServerStart")}
              </Button>
            ) : (
              <Button
                className="h-8 shrink-0"
                variant="outline"
                disabled={serverBusy}
                onClick={stopLocalServer}
              >
                {t("network.speedServerStop")}
              </Button>
            ))}

          <div className="ml-auto flex shrink-0 items-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8"
              disabled={busy}
              onClick={() => setAdvanced((v) => !v)}
            >
              {t("network.speedAdvanced")}
              <ChevronDown
                size={14}
                className={cn(
                  "ml-1 transition-transform",
                  advanced && "rotate-180",
                )}
              />
            </Button>

            {!busy ? (
              <Button className="h-8" onClick={start}>
                {t("network.speedStart")}
              </Button>
            ) : (
              <Button className="h-8" variant="destructive" onClick={stop}>
                {t("network.speedStop")}
              </Button>
            )}
          </div>
        </div>

        {advanced && (
          <div className="space-y-2 border-t border-border pt-2.5">
            <div className="grid grid-cols-4 gap-x-3 gap-y-2">
              <div className="min-w-0 space-y-1">
                <Label className="block truncate text-xs">
                  {t("network.speedDownloadSize")}
                </Label>
                <Input
                  className="h-8 w-full"
                  type="number"
                  min={1}
                  max={200}
                  disabled={busy}
                  value={downloadMb}
                  onChange={(e) => setDownloadMb(Number(e.target.value) || 1)}
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="block truncate text-xs">
                  {t("network.speedUploadSize")}
                </Label>
                <Input
                  className="h-8 w-full"
                  type="number"
                  min={1}
                  max={200}
                  disabled={busy}
                  value={uploadMb}
                  onChange={(e) => setUploadMb(Number(e.target.value) || 1)}
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="block truncate text-xs">
                  {t("network.speedConcurrency")}
                </Label>
                <Input
                  className="h-8 w-full"
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
              <div className="min-w-0 space-y-1">
                <Label className="block truncate text-xs">
                  {t("network.speedRounds")}
                </Label>
                <Input
                  className="h-8 w-full"
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
              {mode === "custom" && (
                <div className="col-span-4 min-w-0 space-y-1">
                  <Label className="text-xs">
                    {t("network.speedLatencyUrl")}
                  </Label>
                  <Input
                    className="h-8 w-full font-mono text-xs"
                    disabled={busy}
                    value={latencyUrl}
                    onChange={(e) => setLatencyUrl(e.target.value)}
                    placeholder={t("network.speedLatencyUrlOptional")}
                  />
                </div>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("network.speedMedianHint")}
            </p>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          {modeHint}
        </p>
      </div>

      {/* 状态 */}
      {(busy || activeServer || error) && (
        <div className="shrink-0 space-y-1">
          {busy && phaseHint && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {phaseHint}
            </p>
          )}
          {activeServer && mode === "internet" && (
            <p className="text-xs text-muted-foreground">
              {t("network.speedActiveNode")}: {serverLabel(activeServer)}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {/* 延迟 / 抖动 */}
      <div className="grid shrink-0 grid-cols-2 gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">
            {t("network.speedLatency")}
          </div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {fmtMs(displayLat)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            {t("network.speedJitter")}
          </div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {fmtMs(displayJit)}
          </div>
        </div>
      </div>

      {/* 图表 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-border/60 p-3">
          <div className="shrink-0 text-sm font-medium">
            {t("network.speedDownload")}: {fmtMbps(displayDl)}{" "}
            {t("network.speedMbps")}
          </div>
          <SpeedGauge
            label={t("network.speedDownload")}
            value={displayDl}
            color={DL_COLOR}
            max={gaugeMaxScale}
            active={dlGaugeActive}
          />
          <div className="min-h-0 flex-1">
            <SpeedLineChart
              data={dlSamples}
              color={DL_COLOR}
              label={t("network.speedDownload")}
              emptyHint={
                busy && isDownloadPhase(phase ?? "")
                  ? t("network.speedRunning")
                  : t("network.speedEmpty")
              }
              className="h-full min-h-[120px]"
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-border/60 p-3">
          <div className="shrink-0 text-sm font-medium">
            {t("network.speedUpload")}: {fmtMbps(displayUl)}{" "}
            {t("network.speedMbps")}
          </div>
          <SpeedGauge
            label={t("network.speedUpload")}
            value={displayUl}
            color={UL_COLOR}
            max={gaugeMaxScale}
            active={ulGaugeActive}
          />
          <div className="min-h-0 flex-1">
            <SpeedLineChart
              data={ulSamples}
              color={UL_COLOR}
              label={t("network.speedUpload")}
              emptyHint={
                busy && isUploadPhase(phase ?? "")
                  ? t("network.speedRunning")
                  : t("network.speedEmpty")
              }
              className="h-full min-h-[120px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
