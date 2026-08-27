/**
 * @file 已知 SSH 主机密钥设置区
 * @author Charlie
 */

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingField } from "@/features/settings/SettingField";
import { listKnownHosts, removeKnownHost, type KnownHostRow } from "@/lib/db";

export function KnownHostsSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<KnownHostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setRows(await listKnownHosts());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload().catch(console.error);
  }, []);

  const onRemove = async (row: KnownHostRow) => {
    try {
      await removeKnownHost(row.id);
      await reload();
      toast.success(t("settings.knownHostRemoved"));
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <SettingField
      label={t("settings.knownHosts")}
      hint={t("settings.knownHostsHint")}
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.knownHostsEmpty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-[minmax(120px,1fr)_72px_minmax(160px,1.2fr)_40px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{t("settings.knownHostHost")}</span>
            <span>{t("settings.knownHostPort")}</span>
            <span className="col-span-1">
              {t("settings.knownHostFingerprint")}
            </span>
            <span />
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(120px,1fr)_72px_minmax(160px,1.2fr)_40px] items-center gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0"
            >
              <span className="truncate font-medium">{row.host}</span>
              <span>{row.port}</span>
              <span
                className="min-w-0 truncate font-mono text-muted-foreground"
                title={`SHA256:${row.fingerprint}`}
              >
                SHA256:{row.fingerprint}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("settings.knownHostRemove")}
                onClick={() => onRemove(row).catch(console.error)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </SettingField>
  );
}
