/**
 * @file IP / 子网计算器面板
 * @author Charlie
 * @description 展示 CIDR 网段详情、IP 归属检测，以及按数量 / 主机数划分的子网表。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  allocateByHosts,
  calcCidr,
  ipInNetwork,
  splitSubnets,
} from "@/lib/ipcalc";
import { clipboardWriteText } from "@/lib/clipboard";

/** IPv4 CIDR 与子网划分面板 */
export function IpCalcPanel() {
  const { t } = useTranslation();
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [mask, setMask] = useState("");
  const [checkIp, setCheckIp] = useState("192.168.1.10");
  const [subnetCount, setSubnetCount] = useState(4);
  const [hostsPer, setHostsPer] = useState(50);
  const [rows, setRows] = useState<ReturnType<typeof splitSubnets>>([]);

  const result = useMemo(() => calcCidr(cidr, mask || undefined), [cidr, mask]);
  const inNet = useMemo(
    () => ipInNetwork(checkIp, result.cidr),
    [checkIp, result.cidr],
  );

  const copyTable = async () => {
    const header = "index,cidr,network,broadcast,first,last,hosts";
    const body = rows
      .map(
        (r) =>
          `${r.index},${r.cidr},${r.network},${r.broadcast},${r.firstHost},${r.lastHost},${r.hostCount}`,
      )
      .join("\n");
    await clipboardWriteText(`${header}\n${body}`);
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs muted">
            {t("network.cidr")}
            <input
              className="field"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs muted">
            {t("network.mask")}
            <input
              className="field"
              value={mask}
              placeholder="255.255.255.0"
              onChange={(e) => setMask(e.target.value)}
            />
          </label>
        </div>
        {result.error ? (
          <div className="text-sm text-[var(--danger)]">{result.error}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-sm sm:grid-cols-3">
            {[
              [t("network.networkAddr"), result.network],
              [t("network.broadcast"), result.broadcast],
              [t("network.mask"), result.mask],
              [t("network.wildcard"), result.wildcard],
              [t("network.firstHost"), result.firstHost],
              [t("network.lastHost"), result.lastHost],
              [t("network.hostCount"), String(result.hostCount)],
              ["CIDR", result.cidr],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="text-[11px] muted">{k}</div>
                <div className="font-mono text-sm">{v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs muted">
            {t("network.containsIp")}
            <input
              className="field"
              value={checkIp}
              onChange={(e) => setCheckIp(e.target.value)}
            />
          </label>
          <div className="chip">
            {inNet == null ? "—" : inNet ? "✓ in" : "✗ out"}
          </div>
        </div>

        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2 text-sm font-medium">
            {t("network.splitSubnets")}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex w-32 flex-col gap-1 text-xs muted">
              {t("network.subnetCount")}
              <input
                className="field"
                type="number"
                min={1}
                value={subnetCount}
                onChange={(e) => setSubnetCount(Number(e.target.value) || 1)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setRows(splitSubnets(result.cidr, subnetCount))}
            >
              {t("network.allocate")}
            </button>
            <label className="flex w-36 flex-col gap-1 text-xs muted">
              {t("network.hostsPerSubnet")}
              <input
                className="field"
                type="number"
                min={1}
                value={hostsPer}
                onChange={(e) => setHostsPer(Number(e.target.value) || 1)}
              />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => setRows(allocateByHosts(result.cidr, hostsPer))}
            >
              {t("network.allocate")}
            </button>
            {rows.length > 0 && (
              <button type="button" className="btn" onClick={copyTable}>
                {t("network.copy")}
              </button>
            )}
          </div>
          {rows.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-elevated)] muted">
                  <tr>
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">CIDR</th>
                    <th className="px-2 py-1.5">{t("network.networkAddr")}</th>
                    <th className="px-2 py-1.5">{t("network.broadcast")}</th>
                    <th className="px-2 py-1.5">{t("network.firstHost")}</th>
                    <th className="px-2 py-1.5">{t("network.lastHost")}</th>
                    <th className="px-2 py-1.5">{t("network.hostCount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.index}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-2 py-1">{r.index}</td>
                      <td className="px-2 py-1 font-mono">{r.cidr}</td>
                      <td className="px-2 py-1 font-mono">{r.network}</td>
                      <td className="px-2 py-1 font-mono">{r.broadcast}</td>
                      <td className="px-2 py-1 font-mono">{r.firstHost}</td>
                      <td className="px-2 py-1 font-mono">{r.lastHost}</td>
                      <td className="px-2 py-1">{r.hostCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
