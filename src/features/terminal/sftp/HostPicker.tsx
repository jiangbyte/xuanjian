/**
 * @file SFTP 主机选择弹层
 * @author Charlie
 * @description 为左右侧选择本地文件系统或已保存主机作为传输端点。
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { Computer, Server } from "lucide-react";
import type { HostRow } from "@/lib/db";
import type { Side } from "@/features/terminal/sftp/types";
import { hostTitle } from "@/features/terminal/sftp/pathUtils";

const rowClass =
  "flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-accent";

/** 主机/本机选择浮层 */
export function HostPicker({
  side,
  hosts,
  onClose,
  onPickLocal,
  onPickHost,
}: {
  side: Side;
  hosts: HostRow[];
  onClose: () => void;
  onPickLocal: () => void;
  onPickHost: (host: HostRow) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(query) ||
        h.host.toLowerCase().includes(query) ||
        h.username.toLowerCase().includes(query),
    );
  }, [hosts, q]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{t("terminal.pickHost")}</span>
            <Badge variant="secondary">
              {side === "left" ? t("terminal.leftSide") : t("terminal.rightSide")}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            placeholder={t("terminal.searchHosts")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-[50vh] overflow-auto">
            <div className="mb-3 space-y-1">
              <div className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">
                {t("terminal.localMachine")}
              </div>
              <div className="space-y-0.5">
                <button type="button" className={rowClass} onClick={onPickLocal}>
                  <div className="min-w-0 w-full space-y-0.5">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Computer size={14} />
                      {t("terminal.localFs")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("terminal.browseLocal")}
                    </div>
                  </div>
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">
                {t("terminal.hosts")}
              </div>
              <div className="space-y-0.5">
                {filtered.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={rowClass}
                    onClick={() => onPickHost(h)}
                  >
                    <div className="min-w-0 w-full space-y-0.5">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Server size={14} />
                        {hostTitle(h)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {h.username}@{h.host}
                      </div>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {t("hosts.empty")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
