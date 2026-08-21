/**
 * @file 会话日志列表控制台
 * @author Charlie
 * @description 按 SSH/本地筛选与搜索浏览历史会话录制，支持置顶、打开详情与删除。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Monitor, Pin, ScrollText, Search, Server, Trash2 } from "lucide-react";
import {
  deleteSessionLog,
  listSessionLogs,
  SessionLogRow,
  setSessionLogPinned,
} from "@/lib/db";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { useDialog } from "@/components/Dialog";
import { formatBytes, formatLogTimeRange } from "@/features/logs/logExport";

type KindFilter = "all" | "ssh" | "local";

/** 会话日志列表页 */
export function LogsConsole() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dialog = useDialog();
  const { open: openMenu } = useContextMenu();
  const [rows, setRows] = useState<SessionLogRow[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  const reload = useCallback(async () => {
    const list = await listSessionLogs({
      kind: kind === "all" ? null : kind,
      search,
    });
    setRows(list);
  }, [kind, search]);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const filtered = useMemo(() => rows, [rows]);

  const onDelete = async (row: SessionLogRow) => {
    if (!(await dialog.confirm(t("logs.deleteConfirm"), { danger: true }))) {
      return;
    }
    await deleteSessionLog(row.id);
    await reload();
  };

  return (
    <div className="flex h-full flex-col">
      {/* —— 工具栏：搜索与类型筛选 —— */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2">
          <ScrollText size={18} className="text-[var(--accent)]" />
          <h1 className="text-lg font-semibold">{t("logs.title")}</h1>
        </div>
        <div className="field-icon-wrap min-w-[200px] flex-1">
          <Search size={14} className="field-icon" />
          <input
            className="field"
            placeholder={t("logs.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", t("logs.filterAll")],
              ["ssh", t("logs.filterSsh")],
              ["local", t("logs.filterLocal")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`btn btn-sm ${kind === k ? "btn-primary" : ""}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* —— 日志列表 —— */}
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {filtered.length === 0 ? (
          <div className="empty-state">{t("logs.empty")}</div>
        ) : (
          <div className="space-y-1">
            {filtered.map((row) => {
              const sub =
                row.kind === "ssh"
                  ? `${row.remote_user || "?"}@${row.remote_host || "?"}`
                  : t("logs.kindLocal");
              return (
                <div
                  key={row.id}
                  className="list-row cursor-pointer"
                  onClick={() => navigate(`/logs/${row.id}`)}
                  onContextMenu={(e) =>
                    openContextMenu(e, openMenu, [
                      {
                        id: "open",
                        label: t("logs.open"),
                        onClick: () => navigate(`/logs/${row.id}`),
                      },
                      {
                        id: "pin",
                        label: row.pinned ? t("logs.unpin") : t("logs.pin"),
                        onClick: async () => {
                          await setSessionLogPinned(row.id, !row.pinned);
                          await reload();
                        },
                      },
                      "sep",
                      {
                        id: "delete",
                        label: t("logs.delete"),
                        danger: true,
                        onClick: () => {
                          onDelete(row).catch(console.error);
                        },
                      },
                    ])
                  }
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="host-avatar shrink-0">
                      {row.kind === "ssh" ? (
                        <Server size={16} />
                      ) : (
                        <Monitor size={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {row.title}
                        </span>
                        {row.pinned ? (
                          <Pin
                            size={12}
                            className="shrink-0 text-[var(--accent)]"
                          />
                        ) : null}
                        {row.status === "open" ? (
                          <span className="chip chip-accent shrink-0">
                            {t("logs.live")}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs muted">
                        {formatLogTimeRange(
                          row.started_at,
                          row.ended_at,
                          t("logs.live"),
                        )}{" "}
                        · {sub}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs muted">
                      <div>{formatBytes(row.bytes_out)}</div>
                      <div className="uppercase">{row.kind}</div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("logs.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(row).catch(console.error);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
