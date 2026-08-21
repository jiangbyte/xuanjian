import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Play, Search, Terminal, Trash2 } from "lucide-react";
import { api } from "../../../lib/tauri";
import { clipboardWriteText } from "../../../lib/clipboard";
import { useCmdHistory } from "../../../stores/cmdHistory";
import { useDialog } from "../../../components/Dialog";

export function HistoryPane({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const dialog = useDialog();
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
      await dialog.alert(t("scripts.needSessionShort"));
      return;
    }
    try {
      await api.sessionWrite(sessionId, cmd.endsWith("\n") ? cmd : `${cmd}\n`);
    } catch (e) {
      await dialog.alert(String(e));
    }
  };

  const copy = async (cmd: string) => {
    try {
      await clipboardWriteText(cmd);
    } catch {
      await dialog.alert(t("termTab.copyFail"));
    }
  };

  return (
    <div className="panel flex h-full flex-col">
      <div className="panel-header flex items-center gap-2">
        <span className="text-xs font-medium">{t("termTab.history")}</span>
        <span className="text-xs muted">
          {t("termTab.historyCount", { count: filtered.length })}
        </span>
        <button
          className="icon-btn icon-btn-sm ml-auto tip"
          data-tip={t("termTab.clearHistory")}
          onClick={async () => {
            if (
              await dialog.confirm(t("termTab.clearHistoryConfirm"), {
                danger: true,
              })
            ) {
              clear();
            }
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="border-b border-[var(--border)] px-2 py-2">
        <div className="field-icon-wrap">
          <Search size={13} className="field-icon" />
          <input
            className="field field-sm"
            placeholder={t("termTab.historySearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="mt-2 flex gap-1">
          <button
            className={`btn btn-sm ${!scopeGlobal ? "btn-primary" : ""}`}
            onClick={() => setScopeGlobal(false)}
          >
            <Terminal size={12} />
            {t("termTab.historySession")}
          </button>
          <button
            className={`btn btn-sm ${scopeGlobal ? "btn-primary" : ""}`}
            onClick={() => setScopeGlobal(true)}
          >
            {t("termTab.historyGlobal")}
          </button>
        </div>
      </div>
      <div className="panel-body panel-list min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs muted">
            {t("termTab.historyEmpty")}
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="list-row group" title={item.cmd}>
              <span className="list-row-title list-row-title-mono min-w-0 flex-1 truncate text-left text-[12px]">
                {item.cmd}
              </span>
              <button
                type="button"
                className="icon-btn icon-btn-sm tip shrink-0 opacity-60 group-hover:opacity-100"
                data-tip={t("termTab.historyCopy")}
                onClick={() => copy(item.cmd).catch(console.error)}
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-sm tip shrink-0 opacity-60 group-hover:opacity-100"
                data-tip={t("termTab.historyRun")}
                onClick={() => run(item.cmd).catch(console.error)}
              >
                <Play size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
