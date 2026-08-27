/**
 * @file DNS 查询结果表
 * @author Charlie
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DnsRecordRow } from "@/lib/tauri";

/** 结构化 DNS 记录表 */
export function DnsResults({
  records,
  busy,
}: {
  records: DnsRecordRow[];
  busy: boolean;
}) {
  const { t } = useTranslation();

  if (records.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
        {busy ? t("network.running") : t("network.vizEmpty")}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>{t("network.dnsType")}</TableHead>
            <TableHead>{t("network.dnsName")}</TableHead>
            <TableHead>{t("network.dnsValue")}</TableHead>
            <TableHead>TTL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((row, i) => (
            <TableRow key={`${row.recordType}-${row.value}-${i}`}>
              <TableCell>
                <Badge variant="secondary" className="font-mono text-xs">
                  {row.recordType}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[140px] truncate font-mono text-xs">
                {row.name}
              </TableCell>
              <TableCell className="break-all font-mono text-xs">
                {row.priority != null ? `${row.priority} ` : ""}
                {row.value}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {row.ttl ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
