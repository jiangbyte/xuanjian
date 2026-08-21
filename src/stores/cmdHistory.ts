/**
 * @file 命令历史 Store
 * @author Charlie
 * @description 终端命令历史的内存态与 localStorage 持久化。
 * 按命令去重、最多保留 500 条；不写 SQLite。
 */

import { create } from "zustand";

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

const KEY = "xuanjian.cmdHistory";
const MAX = 500;

function load(): CmdHistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: CmdHistoryItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
}

/**
 * 命令历史 Zustand store。
 * @副作用 `push` / `clear` 会读写 localStorage
 */
export const useCmdHistory = create<HistState>((set, get) => ({
  items: load(),
  /** 追加一条命令；同内容去重置顶，超过 MAX 截断 */
  push: (item) => {
    const cmd = item.cmd.trim();
    if (!cmd) return;
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
    save(items);
    set({ items });
  },
  /** 清空历史并删除持久化键 */
  clear: () => {
    localStorage.removeItem(KEY);
    set({ items: [] });
  },
}));
