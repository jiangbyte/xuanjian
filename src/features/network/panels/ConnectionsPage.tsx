/**
 * @file 本机连接与监听端口（netstat2）
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type SocketRow } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** 本机 TCP/UDP 套接字列表 */
export function ConnectionsPage() {
  const { t } = useTranslation();
  const [protocol, setProtocol] = useState("all");
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<SocketRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.networkListConnections(
        protocol === "all" ? null : protocol,
      );
      setRows(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [protocol]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.localAddr.toLowerCase().includes(q) ||
        r.remoteAddr.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q) ||
        String(r.pid ?? "").includes(q),
    );
  }, [rows, filter]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 space-y-1.5">
          <Label>{t("network.connProtocol")}</Label>
          <Select value={protocol} onValueChange={setProtocol}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("network.connAll")}</SelectItem>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="conn-filter">{t("network.filter")}</Label>
          <Input
            id="conn-filter"
            className="h-8"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("network.connFilterPlaceholder")}
          />
        </div>
        <Button
          className="h-8"
          variant="outline"
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
              <TableHead>{t("network.connProtocol")}</TableHead>
              <TableHead>{t("network.localAddr")}</TableHead>
              <TableHead>{t("network.remoteAddr")}</TableHead>
              <TableHead>{t("network.status")}</TableHead>
              <TableHead>PID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {busy ? t("network.running") : t("network.connEmpty")}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, i) => (
                <TableRow
                  key={`${r.protocol}-${r.localAddr}-${r.remoteAddr}-${i}`}
                >
                  <TableCell className="font-mono text-xs">
                    {r.protocol}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.localAddr}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.remoteAddr || "—"}
                  </TableCell>
                  <TableCell className="text-xs">{r.state}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.pid ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("network.connCount", { count: filtered.length })}
      </p>
    </div>
  );
}
