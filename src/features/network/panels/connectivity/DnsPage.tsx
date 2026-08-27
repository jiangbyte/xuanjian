/**
 * @file DNS 连通性页面（hickory-resolver）
 * @author Charlie
 */

import { useState } from "react";
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
import { api, type DnsRecordRow } from "@/lib/tauri";
import { DnsResults } from "./DnsResults";
import { RawLog } from "./RawLog";

/** DNS：结构化结果 + 原始日志 */
export function DnsPage() {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
  const [nameserver, setNameserver] = useState("");
  const [dnsType, setDnsType] = useState("A");
  const [lines, setLines] = useState<string[]>([]);
  const [records, setRecords] = useState<DnsRecordRow[]>([]);
  const [busy, setBusy] = useState(false);

  const clear = () => {
    setLines([]);
    setRecords([]);
  };

  const start = async () => {
    const host = target.trim();
    if (!host) return;
    clear();
    setBusy(true);
    try {
      const rows = await api.networkDnsResolve(
        host,
        dnsType,
        nameserver.trim() || null,
      );
      setRecords(rows);
      const text = rows
        .map(
          (r) =>
            `${r.recordType}\t${r.name}\t${r.priority != null ? `${r.priority} ` : ""}${r.value}${r.ttl != null ? ` (ttl=${r.ttl})` : ""}`,
        )
        .join("\n");
      setLines(text.split("\n"));
      await addNetworkHistory("dns", `${dnsType} ${host}`, text.slice(0, 500));
    } catch (e) {
      setLines([String(e)]);
      setRecords([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="dns-target">{t("network.host")}</Label>
          <Input
            id="dns-target"
            className="h-8"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder={t("network.hostPlaceholder")}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <Label htmlFor="dns-ns">{t("network.dnsServer")}</Label>
          <Input
            id="dns-ns"
            className="h-8"
            value={nameserver}
            onChange={(e) => setNameserver(e.target.value)}
            placeholder={t("network.dnsServerPlaceholder")}
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label>{t("network.dnsType")}</Label>
          <Select value={dnsType} onValueChange={setDnsType}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "A",
                "AAAA",
                "MX",
                "TXT",
                "PTR",
                "NS",
                "CNAME",
                "SOA",
                "SRV",
              ].map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="h-8" onClick={start} disabled={busy}>
          {t("network.lookup")}
        </Button>
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
        <div className="flex min-h-0 flex-[2] flex-col overflow-hidden">
          <DnsResults records={records} busy={busy} />
        </div>
        <div className="flex min-h-0 flex-[1] flex-col">
          <RawLog lines={lines} busy={busy} />
        </div>
      </div>
    </div>
  );
}
