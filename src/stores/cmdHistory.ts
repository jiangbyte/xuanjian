/**
 * @file 命令历史 Store
 * @author Charlie
 * @description 终端命令历史的内存态；持久化到 SQLite，启动时从 DB 加载。
 */

import { create } from "zustand";
import {
  clearCmdHistory,
  insertCmdHistory,
  listCmdHistory,
  type CmdHistoryRow,
} from "@/lib/db/cmdHistory";

/** 单条命令历史记录 */
export type CmdHistoryItem = {
  id: string;
  cmd: string;
  at: number;
  sessionId: string | null;
  label?: string;
};

type HistState = {
  items: CmdHistoryItem[];
  push: (item: Omit<CmdHistoryItem, "id" | "at"> & { at?: number }) => void;
  clear: () => void;
};

const MAX = 500;

function rowToItem(row: CmdHistoryRow): CmdHistoryItem {
  return {
    id: String(row.id),
    cmd: row.cmd,
    at: new Date(row.created_at).getTime(),
    sessionId: row.session_id,
    label: row.label ?? undefined,
  };
}

/**
 * 从 SQLite 加载命令历史到 store。
 */
export async function hydrateCmdHistory(): Promise<void> {
  try {
    const rows = await listCmdHistory({ limit: MAX });
    useCmdHistory.setState({ items: rows.map(rowToItem) });
  } catch (err) {
    console.error(err);
  }
}

/**
 * 命令历史 Zustand store。
 * @副作用 `push` 写入 SQLite；`clear` 清空 DB
 */
export const useCmdHistory = create<HistState>((set, get) => ({
  items: [],
  /** 追加一条命令；同内容去重置顶，超过 MAX 截断 */
  push: (item) => {
    const cmd = item.cmd.trim();
    if (!cmd) return;
    void insertCmdHistory({
      cmd,
      sessionId: item.sessionId,
      label: item.label ?? null,
    }).catch(console.error);
    const next: CmdHistoryItem = {
      id: crypto.randomUUID(),
      cmd,
      at: item.at ?? Date.now(),
      sessionId: item.sessionId,
      label: item.label,
    };
    const items = [next, ...get().items.filter((x) => x.cmd !== cmd)].slice(
      0,
      MAX,
    );
    set({ items });
  },
  /** 清空历史并删除 DB 记录 */
  clear: () => {
    void clearCmdHistory().catch(console.error);
    set({ items: [] });
  },
}));
