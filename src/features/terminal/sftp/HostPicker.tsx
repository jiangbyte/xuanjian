/**
 * @file SFTP 主机选择弹层
 * @author Charlie
 * @description 为左右侧选择本地文件系统或已保存主机作为传输端点。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Computer, Server, X } from "lucide-react";
import type { HostRow } from "@/lib/db";
import type { Side } from "@/features/terminal/sftp/types";
import { hostTitle } from "@/features/terminal/sftp/pathUtils";

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
    <div
      className="overlay z-[90] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="modal-card flex w-full max-w-md flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <input
            autoFocus
            className="field field-sm flex-1"
            placeholder={t("terminal.searchHosts")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="chip chip-accent">
            {side === "left" ? t("terminal.leftSide") : t("terminal.rightSide")}
          </span>
          <button className="icon-btn icon-btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-auto px-2 py-2">
          <section className="menu-section">
            <div className="menu-section-title">
              {t("terminal.localMachine")}
            </div>
            <div className="menu-list">
              <button
                type="button"
                className="list-row list-row-stack"
                onClick={onPickLocal}
              >
                <span className="list-row-title flex items-center gap-2">
                  <Computer size={14} />
                  {t("terminal.localFs")}
                </span>
                <span className="list-row-sub">
                  {t("terminal.browseLocal")}
                </span>
              </button>
            </div>
          </section>
          <section className="menu-section">
            <div className="menu-section-title">{t("terminal.hosts")}</div>
            <div className="menu-list">
              {filtered.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="list-row list-row-stack"
                  onClick={() => onPickHost(h)}
                >
                  <span className="list-row-title flex items-center gap-2">
                    <Server size={14} />
                    {hostTitle(h)}
                  </span>
                  <span className="list-row-sub truncate">
                    {h.username}@{h.host}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs muted">
                  {t("hosts.empty")}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
