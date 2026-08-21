/**
 * @file DNS 连通性页面（独立状态）
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
import { api } from "@/lib/tauri";
import { addNetworkHistory } from "@/lib/db";
import { DnsResults } from "./DnsResults";
import { RawLog } from "./RawLog";

/** DNS：原文 + 结果表，状态与其它模式隔离 */
export function DnsPage() {
  const { t } = useTranslation();
  const [target, setTarget] = useState("1.1.1.1");
  const [dnsType, setDnsType] = useState("A");
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const clear = () => setLines([]);

  const start = async () => {
    const host = target.trim();
    if (!host) return;
    clear();
    setBusy(true);
    try {
      const out = await api.networkDnsLookup(host, dnsType);
      setLines(out.split("\n"));
      await addNetworkHistory("dns", `${dnsType} ${host}`, out.slice(0, 500));
    } catch (e) {
      setLines([String(e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="dns-target">{t("network.host")}</Label>
          <Input
            id="dns-target"
            className="h-8"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label>{t("network.dnsType")}</Label>
          <Select value={dnsType} onValueChange={setDnsType}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["A", "AAAA", "MX", "TXT", "PTR", "NS", "CNAME"].map((type) => (
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
        <Button className="h-8" variant="outline" onClick={clear} disabled={busy}>
          {t("network.clear")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-[3] flex-col">
          <RawLog lines={lines} busy={busy} />
        </div>
        <div className="flex min-h-0 flex-[2] flex-col overflow-hidden">
          <DnsResults lines={lines} recordType={dnsType} busy={busy} />
        </div>
      </div>
    </div>
  );
}
