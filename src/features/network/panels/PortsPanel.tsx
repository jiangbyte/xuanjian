/**
 * @file TCP 端口探测面板
 * @author Charlie
 * @description 解析端口列表/区间，分批 TCP 探测并展示开闭与延迟，可导出 CSV。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import { addNetworkHistory } from "@/lib/db";
import { COMMON_PORTS } from "@/lib/network/ipcalc";
import { api, type TcpProbeResult } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** 解析 `22,80,443` 或 `8000-8010` 等形式，最多 500 个端口 */
function parsePorts(input: string): number[] {
  const set = new Set<number>();
  for (const part of input.split(/[,\s]+/).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.min(Math.max(a, b), 65535);
      for (let p = Math.max(1, lo); p <= hi; p++) set.add(p);
    } else {
      const p = Number(part);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) set.add(p);
    }
  }
  return [...set].sort((a, b) => a - b).slice(0, 500);
}

/** TCP 端口扫描面板 */
export function PortsPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [range, setRange] = useState("");
  const [timeoutText, setTimeoutText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TcpProbeResult[]>([]);
  const [progress, setProgress] = useState(0);

  const ports = useMemo(() => parsePorts(range), [range]);
  const timeoutMs = useMemo(() => {
    const n = Number(timeoutText.trim());
    return Number.isFinite(n) && n >= 100 ? Math.min(n, 10_000) : 800;
  }, [timeoutText]);

  const probe = async () => {
    const h = host.trim();
    if (!h || !ports.length) return;
    setBusy(true);
    setResults([]);
    setProgress(0);
    const chunkSize = 20;
    const all: TcpProbeResult[] = [];
    try {
      for (let i = 0; i < ports.length; i += chunkSize) {
        const chunk = ports.slice(i, i + chunkSize);
        const part = await api.networkTcpProbe(h, chunk, timeoutMs);
        all.push(...part);
        setResults([...all]);
        setProgress(Math.round((all.length / ports.length) * 100));
      }
      await addNetworkHistory(
        "ports",
        h,
        `${all.filter((r) => r.open).length}/${all.length} open`,
      );
    } catch (e) {
      setResults([
        {
          host: h,
          port: 0,
          open: false,
          error: String(e),
        },
      ]);
    } finally {
      setBusy(false);
      setProgress(100);
    }
  };

  const exportCsv = async () => {
    const csv = [
      "host,port,open,latencyMs,error",
      ...results.map(
        (r) =>
          `${r.host},${r.port},${r.open},${r.latencyMs ?? ""},${r.error ?? ""}`,
      ),
    ].join("\n");
    await clipboardWriteText(csv);
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-3",
        !embedded && "p-4",
      )}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1 space-y-1.5">
          <Label htmlFor="ports-host">{t("network.host")}</Label>
          <Input
            id="ports-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t("network.hostPlaceholder")}
          />
        </div>
        <div className="min-w-[200px] flex-[2] space-y-1.5">
          <Label htmlFor="ports-range">{t("network.portRange")}</Label>
          <Input
            id="ports-range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder={t("network.portRangePlaceholder")}
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor="ports-timeout">{t("network.timeoutMs")}</Label>
          <Input
            id="ports-timeout"
            type="number"
            value={timeoutText}
            onChange={(e) => setTimeoutText(e.target.value)}
            placeholder="800"
          />
        </div>
        <Button disabled={busy} onClick={probe}>
          {busy ? `${progress}%` : t("network.probe")}
        </Button>
        <Button
          variant="outline"
          disabled={!results.length}
          onClick={exportCsv}
        >
          {t("network.export")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="text-xs text-muted-foreground">
          {t("network.commonPorts")}:
        </span>
        {COMMON_PORTS.map((p) => (
          <Badge
            key={p.port}
            asChild
            variant="secondary"
            className="cursor-pointer"
          >
            <button
              type="button"
              onClick={() =>
                setRange((prev) =>
                  prev.includes(String(p.port))
                    ? prev
                    : prev
                      ? `${prev},${p.port}`
                      : String(p.port),
                )
              }
            >
              {p.port}/{p.name}
            </button>
          </Badge>
        ))}
      </div>
      {busy && <Progress value={progress} />}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t("network.port")}</TableHead>
              <TableHead>{t("network.status")}</TableHead>
              <TableHead>RTT</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={`${r.host}:${r.port}`}>
                <TableCell className="font-mono">{r.port || "—"}</TableCell>
                <TableCell>
                  <Badge variant={r.open ? "default" : "secondary"}>
                    {r.open ? t("network.open") : t("network.closed")}
                  </Badge>
                </TableCell>
                <TableCell>
                  {r.latencyMs != null ? `${r.latencyMs} ms` : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.error || ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
