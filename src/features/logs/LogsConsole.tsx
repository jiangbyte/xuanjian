/**
 * @file 会话日志列表控制台
 * @author Charlie
 * @description 按 SSH/本地筛选与搜索浏览历史会话录制，支持置顶、打开详情与删除。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { dialogs } from "@/lib/dialogs";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Monitor, Pin, ScrollText, Search, Server, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  deleteSessionLog,
  listSessionLogs,
  SessionLogRow,
  setSessionLogPinned,
} from "@/lib/db";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { formatBytes, formatLogTimeRange } from "@/features/logs/logExport";

type KindFilter = "all" | "ssh" | "local";

/** 会话日志列表页 */
export function LogsConsole() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { open: openMenu } = useContextMenu();
  const [rows, setRows] = useState<SessionLogRow[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  const reload = useCallback(async () => {
    const { reconcileOrphanOpenLogs } = await import("@/lib/sessionRecorder");
    await reconcileOrphanOpenLogs();
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
    if (!(await dialogs.confirm(t("logs.deleteConfirm"), { danger: true }))) {
      return;
    }
    await deleteSessionLog(row.id);
    await reload();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-nowrap items-center gap-2">
            <ScrollText size={18} className="text-primary" />
            <h1 className="text-lg font-semibold">{t("logs.title")}</h1>
          </div>
          <InputGroup className="min-w-[200px] flex-1">
            <InputGroupAddon>
              <Search size={14} />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("logs.search")}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </InputGroup>
          <div className="flex flex-nowrap gap-1">
            {(
              [
                ["all", t("logs.filterAll")],
                ["ssh", t("logs.filterSsh")],
                ["local", t("logs.filterLocal")],
              ] as const
            ).map(([k, label]) => (
              <Button
                key={k}
                size="xs"
                variant={kind === k ? "default" : "outline"}
                onClick={() => setKind(k)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-10">
            <span className="text-muted-foreground">{t("logs.empty")}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((row) => {
              const sub =
                row.kind === "ssh"
                  ? `${row.remote_user || "?"}@${row.remote_host || "?"}`
                  : t("logs.kindLocal");
              return (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-muted"
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
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      {row.kind === "ssh" ? (
                        <Server size={16} />
                      ) : (
                        <Monitor size={16} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{row.title}</span>
                        {row.pinned ? (
                          <Pin size={12} className="shrink-0 text-primary" />
                        ) : null}
                        {row.status === "open" ? (
                          <Badge variant="outline" className="shrink-0">
                            {t("logs.live")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatLogTimeRange(
                          row.started_at,
                          row.ended_at,
                          t("logs.live"),
                        )}{" "}
                        · {sub}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{formatBytes(row.bytes_out)}</div>
                      <div className="uppercase">{row.kind}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("logs.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(row).catch(console.error);
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
