/**
 * @file DNS 查询结果表
 * @author Charlie
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

/** 将 DNS 输出拆成行展示 */
export function DnsResults({
  lines,
  recordType,
  busy,
}: {
  lines: string[];
  recordType: string;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const rows = lines.map((l) => l.trim()).filter(Boolean);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
        {busy ? t("network.running") : t("network.vizEmpty")}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
      <ul className="divide-y divide-border">
        {rows.map((row, i) => (
          <li
            key={`${i}-${row}`}
            className="flex items-start gap-2 px-3 py-2.5 text-sm"
          >
            <Badge
              variant="secondary"
              className="mt-0.5 shrink-0 font-mono text-xs"
            >
              {recordType}
            </Badge>
            <span className="min-w-0 break-all font-mono text-xs leading-relaxed">
              {row}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
