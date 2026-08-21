/**
 * @file 实时抓包面板
 * @author Charlie
 * @description 选择网卡、BPF 过滤器与输出路径，启停 dumpcap/tshark 抓包任务。
 * 并检测本机是否安装抓包工具。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { api, type CaptureTools, type NetInterface } from "@/lib/tauri";
import { addNetworkHistory } from "@/lib/db";

const FILTER_PRESETS = [
  { label: "HTTP", value: "tcp port 80 or tcp port 443" },
  { label: "DNS", value: "port 53" },
  { label: "SSH", value: "tcp port 22" },
  { label: "ICMP", value: "icmp" },
];

/** 实时抓包启停面板 */
export function CapturePanel() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<CaptureTools | null>(null);
  const [ifaces, setIfaces] = useState<NetInterface[]>([]);
  const [iface, setIface] = useState("");
  const [filter, setFilter] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.networkDetectCaptureTools().then(setTools).catch(console.error);
    api
      .networkListInterfaces()
      .then((list) => {
        setIfaces(list);
        if (list[0]) setIface(list[0].name);
      })
      .catch(console.error);
  }, []);

  const toolPath = tools?.dumpcap || tools?.tshark || null;

  const pickPath = async () => {
    const path = await save({
      defaultPath: `capture-${Date.now()}.pcap`,
      filters: [{ name: "pcap", extensions: ["pcap", "pcapng"] }],
    });
    if (path) setOutputPath(path);
  };

  const start = async () => {
    setError(null);
    if (!iface || !outputPath) {
      setError("iface / path required");
      return;
    }
    try {
      const id = await api.networkCaptureStart(
        iface,
        filter.trim() || null,
        outputPath,
      );
      setJobId(id);
      await addNetworkHistory("capture", iface, filter || outputPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const stop = async () => {
    if (!jobId) return;
    await api.networkCaptureStop(jobId);
    setJobId(null);
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-sm">
          {toolPath
            ? t("network.toolsFound", { tool: toolPath })
            : t("network.toolsMissing")}
        </div>
        <label className="flex flex-col gap-1 text-xs muted">
          {t("network.iface")}
          <select
            className="field"
            value={iface}
            onChange={(e) => setIface(e.target.value)}
          >
            {ifaces.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name} ({i.addrs.join(", ") || "—"})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs muted">
          {t("network.filter")}
          <input
            className="field"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="tcp port 80"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {FILTER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              onClick={() => setFilter(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="field flex-1"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder={t("network.outputPath")}
          />
          <button type="button" className="btn" onClick={pickPath}>
            …
          </button>
        </div>
        <div className="flex gap-2">
          {!jobId ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!toolPath}
              onClick={start}
            >
              {t("network.captureStart")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger-fill"
              onClick={stop}
            >
              {t("network.captureStop")}
            </button>
          )}
        </div>
        {error && <div className="text-sm text-[var(--danger)]">{error}</div>}
        {jobId && (
          <div className="text-sm muted">
            {t("network.running")} ({jobId.slice(0, 8)})
          </div>
        )}
      </div>
    </div>
  );
}
