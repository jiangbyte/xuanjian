import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type CaptureTools, type PcapSummary } from "../../../lib/tauri";

export function AnalysisPanel() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<CaptureTools | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<PcapSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.networkDetectCaptureTools().then(setTools).catch(console.error);
  }, []);

  const pick = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "pcap", extensions: ["pcap", "pcapng", "cap"] }],
    });
    if (typeof file === "string") setPath(file);
  };

  const analyze = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const s = await api.networkPcapSummary(path);
      setSummary(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      {!tools?.tshark && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-sm">
          {t("network.toolsMissing")}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          className="field min-w-[240px] flex-1"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="*.pcap"
        />
        <button type="button" className="btn" onClick={pick}>
          {t("network.browsePcap")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !path || !tools?.tshark}
          onClick={analyze}
        >
          {t("network.summarize")}
        </button>
      </div>
      {error && <div className="text-sm text-[var(--danger)]">{error}</div>}
      {summary && (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto">
          <div className="chip">
            {t("network.packets")}: {summary.packetCount}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">{t("network.protocols")}</div>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <tbody>
                  {summary.protocols.map((p) => (
                    <tr key={p.name} className="border-t border-[var(--border)]">
                      <td className="px-3 py-1.5">{p.name}</td>
                      <td className="px-3 py-1.5">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">{t("network.sessions")}</div>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-elevated)] muted">
                  <tr>
                    <th className="px-3 py-1.5">Src</th>
                    <th className="px-3 py-1.5">Dst</th>
                    <th className="px-3 py-1.5">Proto</th>
                    <th className="px-3 py-1.5">{t("network.packets")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.sessions.map((s, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-3 py-1.5 font-mono">{s.src}</td>
                      <td className="px-3 py-1.5 font-mono">{s.dst}</td>
                      <td className="px-3 py-1.5">{s.protocol}</td>
                      <td className="px-3 py-1.5">{s.packets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
