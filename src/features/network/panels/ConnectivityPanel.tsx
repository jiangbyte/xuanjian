import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, onNetworkToolOutput } from "../../../lib/tauri";
import { addNetworkHistory } from "../../../lib/db";
import { Select } from "../../../components/Select";

export function ConnectivityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"ping" | "traceroute" | "dns">("ping");
  const [target, setTarget] = useState("1.1.1.1");
  const [count, setCount] = useState(4);
  const [dnsType, setDnsType] = useState("A");
  const [lines, setLines] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    onNetworkToolOutput((p) => {
      if (jobRef.current && p.jobId !== jobRef.current) return;
      if (p.line) {
        setLines((prev) => [...prev, p.line]);
      }
      if (p.done) {
        setBusy(false);
        setJobId(null);
        jobRef.current = null;
      }
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  const start = async () => {
    const host = target.trim();
    if (!host) return;
    setLines([]);
    setBusy(true);
    try {
      if (mode === "dns") {
        const out = await api.networkDnsLookup(host, dnsType);
        setLines(out.split("\n"));
        setBusy(false);
        await addNetworkHistory("dns", `${dnsType} ${host}`, out.slice(0, 500));
        return;
      }
      const id =
        mode === "ping"
          ? await api.networkPing(host, count)
          : await api.networkTraceroute(host);
      jobRef.current = id;
      setJobId(id);
      await addNetworkHistory(mode, host);
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          {(["ping", "traceroute", "dns"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`}
              onClick={() => setMode(m)}
            >
              {t(`network.${m === "traceroute" ? "traceroute" : m}`)}
            </button>
          ))}
        </div>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs muted">
          {t("network.host")}
          <input
            className="field"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
          />
        </label>
        {mode === "ping" && (
          <label className="flex w-24 flex-col gap-1 text-xs muted">
            {t("network.count")}
            <input
              className="field"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 4)}
            />
          </label>
        )}
        {mode === "dns" && (
          <label className="flex w-28 flex-col gap-1 text-xs muted">
            {t("network.dnsType")}
            <Select
              value={dnsType}
              onChange={setDnsType}
              options={["A", "AAAA", "MX", "TXT", "PTR", "NS", "CNAME"].map(
                (x) => ({ value: x, label: x }),
              )}
            />
          </label>
        )}
        {!busy ? (
          <button type="button" className="btn btn-primary" onClick={start}>
            {mode === "dns" ? t("network.lookup") : t("network.start")}
          </button>
        ) : (
          <button type="button" className="btn btn-danger-fill" onClick={stop}>
            {t("network.stop")}
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setLines([])}
        >
          {t("network.clear")}
        </button>
      </div>
      <pre
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 font-mono text-xs leading-relaxed"
      >
        {lines.length ? lines.join("\n") : busy ? t("network.running") : ""}
      </pre>
    </div>
  );
}
