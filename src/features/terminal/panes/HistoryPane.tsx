/**
 * @file 命令历史面板
 * @author Charlie
 * @description 展示本机记录的终端命令历史，支持会话/全局范围与搜索。
 * 可复制命令或重新写入当前会话执行。
 * 清空会确认后调用 cmdHistory store。
 */

import { Copy, Play, Search, Terminal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import { dialogs } from "@/lib/ui/dialogs";
import { api } from "@/lib/tauri";
import { useCmdHistory } from "@/stores/cmdHistory";

const listRowClass =
  "group flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent";

/**
 * 命令历史侧栏：筛选、复制、重跑、清空。
 */
export function HistoryPane({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const items = useCmdHistory((s) => s.items);
  const clear = useCmdHistory((s) => s.clear);
  const [q, setQ] = useState("");
  const [scopeGlobal, setScopeGlobal] = useState(true);

  const filtered = useMemo(() => {
    let list = items;
    if (!scopeGlobal && sessionId) {
      list = list.filter((x) => x.sessionId === sessionId);
    }
    const query = q.trim().toLowerCase();
    if (query) list = list.filter((x) => x.cmd.toLowerCase().includes(query));
    return list;
  }, [items, q, scopeGlobal, sessionId]);

  const run = async (cmd: string) => {
    if (!sessionId) {
      await dialogs.alert(t("scripts.needSessionShort"));
      return;
    }
    try {
      await api.sessionWrite(sessionId, cmd.endsWith("\n") ? cmd : `${cmd}\n`);
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const copy = async (cmd: string) => {
    try {
      await clipboardWriteText(cmd);
    } catch {
      await dialogs.alert(t("termTab.copyFail"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* —— 标题与清空 —— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium">{t("termTab.history")}</span>
        <span className="text-xs text-muted-foreground">
          {t("termTab.historyCount", { count: filtered.length })}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              aria-label={t("termTab.clearHistory")}
              onClick={async () => {
                if (
                  await dialogs.confirm(t("termTab.clearHistoryConfirm"), {
                    danger: true,
                  })
                ) {
                  clear();
                }
              }}
            >
              <Trash2 size={13} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("termTab.clearHistory")}</TooltipContent>
        </Tooltip>
      </div>

      {/* —— 搜索与范围 —— */}
      <div className="border-b border-border px-2 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search size={13} />
          </InputGroupAddon>
          <InputGroupInput
            className="text-xs"
            placeholder={t("termTab.historySearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <div className="mt-2 flex gap-1">
          <Button
            type="button"
            size="xs"
            variant={!scopeGlobal ? "default" : "outline"}
            onClick={() => setScopeGlobal(false)}
          >
            <Terminal size={12} />
            {t("termTab.historySession")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={scopeGlobal ? "default" : "outline"}
            onClick={() => setScopeGlobal(true)}
          >
            {t("termTab.historyGlobal")}
          </Button>
        </div>
      </div>

      {/* —— 历史列表 —— */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("termTab.historyEmpty")}
          </p>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className={listRowClass} title={item.cmd}>
              <span className="min-w-0 flex-1 truncate text-left font-mono text-sm font-semibold">
                {item.cmd}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 opacity-60 group-hover:opacity-100"
                    aria-label={t("termTab.historyCopy")}
                    onClick={() => copy(item.cmd).catch(console.error)}
                  >
                    <Copy size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("termTab.historyCopy")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 opacity-60 group-hover:opacity-100"
                    aria-label={t("termTab.historyRun")}
                    onClick={() => run(item.cmd).catch(console.error)}
                  >
                    <Play size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("termTab.historyRun")}</TooltipContent>
              </Tooltip>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
