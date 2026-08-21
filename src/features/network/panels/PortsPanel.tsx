import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type TcpProbeResult } from "../../../lib/tauri";
import { COMMON_PORTS } from "../../../lib/ipcalc";
import { addNetworkHistory } from "../../../lib/db";
import { clipboardWriteText } from "../../../lib/clipboard";

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

export function PortsPanel() {
  const { t } = useTranslation();
  const [host, setHost] = useState("127.0.0.1");
  const [range, setRange] = useState("22,80,443");
  const [timeoutMs, setTimeoutMs] = useState(800);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TcpProbeResult[]>([]);
  const [progress, setProgress] = useState(0);

  const ports = useMemo(() => parsePorts(range), [range]);

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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs muted">
          {t("network.host")}
          <input
            className="field"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="flex min-w-[200px] flex-[2] flex-col gap-1 text-xs muted">
          {t("network.portRange")}
          <input
            className="field"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs muted">
          {t("network.timeoutMs")}
          <input
            className="field"
            type="number"
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value) || 800)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={probe}
        >
          {busy ? `${progress}%` : t("network.probe")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!results.length}
          onClick={exportCsv}
        >
          {t("network.export")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="text-xs muted">{t("network.commonPorts")}:</span>
        {COMMON_PORTS.map((p) => (
          <button
            key={p.port}
            type="button"
            className="chip"
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
        ))}
      </div>
      {busy && (
        <div className="h-1 overflow-hidden rounded bg-[var(--border)]">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--bg-elevated)] muted">
            <tr>
              <th className="px-3 py-2">{t("network.port")}</th>
              <th className="px-3 py-2">{t("network.status")}</th>
              <th className="px-3 py-2">RTT</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={`${r.host}:${r.port}`}
                className="border-t border-[var(--border)]"
              >
                <td className="px-3 py-1.5 font-mono">{r.port || "—"}</td>
                <td className="px-3 py-1.5">
                  <span className={`chip ${r.open ? "chip-accent" : ""}`}>
                    {r.open ? t("network.open") : t("network.closed")}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  {r.latencyMs != null ? `${r.latencyMs} ms` : "—"}
                </td>
                <td className="px-3 py-1.5 muted">{r.error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
