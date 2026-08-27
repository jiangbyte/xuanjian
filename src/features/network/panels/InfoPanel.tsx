/**
 * @file 网络配置与信息
 */

import { RefreshCw, Server } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type NetInterface } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const IpCalcPanel = lazy(() =>
  import("@/features/network/panels/IpCalcPanel").then((m) => ({
    default: m.IpCalcPanel,
  })),
);

function InterfacesTab() {
  const { t } = useTranslation();
  const [ifaces, setIfaces] = useState<NetInterface[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setIfaces(await api.networkListInterfaces());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("network.infoHint")}</p>
        <Button
          className="h-8"
          variant="outline"
          size="sm"
          onClick={load}
          disabled={busy}
        >
          <RefreshCw
            className={cn("mr-1.5 size-3.5", busy && "animate-spin")}
          />
          {t("network.refresh")}
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t("network.ifaceName")}</TableHead>
              <TableHead>{t("network.ifaceAddrs")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ifaces.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={2}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {busy ? t("network.running") : t("network.noInterfaces")}
                </TableCell>
              </TableRow>
            ) : (
              ifaces.map((iface) => (
                <TableRow key={iface.name}>
                  <TableCell className="font-mono text-sm">
                    {iface.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {iface.addrs.join(", ")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** 本机网卡与 IP 计算 */
export function InfoPanel() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-4">
      <Tabs
        defaultValue="interfaces"
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <TabsList className="h-8 w-fit shrink-0">
          <TabsTrigger value="interfaces" className="gap-1.5 text-xs">
            <Server size={14} />
            {t("network.interfaces")}
          </TabsTrigger>
          <TabsTrigger value="ipCalc" className="text-xs">
            {t("network.ipCalc")}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="interfaces"
          className="mt-3 flex min-h-0 w-full flex-1 flex-col data-[state=inactive]:hidden"
        >
          <InterfacesTab />
        </TabsContent>
        <TabsContent
          value="ipCalc"
          className="mt-0 flex min-h-0 w-full flex-1 flex-col data-[state=inactive]:hidden"
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                …
              </div>
            }
          >
            <IpCalcPanel embedded />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
