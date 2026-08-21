import { create } from "zustand";

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

export const useCmdHistory = create<HistState>((set, get) => ({
  items: load(),
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
    const items = [next, ...get().items.filter((x) => x.cmd !== cmd)].slice(0, MAX);
    save(items);
    set({ items });
  },
  clear: () => {
    localStorage.removeItem(KEY);
    set({ items: [] });
  },
}));
