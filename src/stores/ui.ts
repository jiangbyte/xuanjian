import { create } from "zustand";
import { api } from "../lib/tauri";

export type TermTab = {
  id: string;
  title: string;
  kind: "local" | "ssh";
  sessionId: string | null;
  hostId?: number;
  /** Local shell id for reconnect (PowerShell / cmd / bash …). */
  shellId?: string;
  /** Active session_logs row while recording. */
  logId?: number;
  status: "connecting" | "open" | "closed" | "error";
};

const LEFT_DEFAULT = 420;
const RIGHT_DEFAULT = 320;
const LEFT_MIN = 260;
const RIGHT_MIN = 240;
const LEFT_MAX = 640;
const RIGHT_MAX = 520;

type UiState = {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  transferOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  switcherOpen: boolean;
  settingsOpen: boolean;
  tabs: TermTab[];
  activeTabId: string | null;
  hostFilter: {
    search: string;
    groupId: number | null;
    tag: string | null;
    sortBy: "name" | "recent" | "status";
  };
  toggleLeft: () => void;
  toggleRight: () => void;
  setTransferOpen: (open: boolean) => void;
  toggleTransfer: () => void;
  setLeftWidth: (w: number, opts?: { persist?: boolean }) => void;
  setRightWidth: (w: number, opts?: { persist?: boolean }) => void;
  setSwitcherOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  addTab: (tab: TermTab) => void;
  updateTab: (id: string, patch: Partial<TermTab>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setHostFilter: (patch: Partial<UiState["hostFilter"]>) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function loadNum(key: string, fallback: number) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const useUiStore = create<UiState>((set, get) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  transferOpen: false,
  leftWidth: loadNum("xuanjian.leftWidth", LEFT_DEFAULT),
  rightWidth: loadNum("xuanjian.rightWidth", RIGHT_DEFAULT),
  switcherOpen: false,
  settingsOpen: false,
  tabs: [],
  activeTabId: null,
  hostFilter: {
    search: "",
    groupId: null,
    tag: null,
    sortBy: "name",
  },
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setTransferOpen: (open) => set({ transferOpen: open }),
  toggleTransfer: () => set((s) => ({ transferOpen: !s.transferOpen })),
  setLeftWidth: (w, opts) => {
    const next = clamp(w, LEFT_MIN, LEFT_MAX);
    if (opts?.persist !== false) {
      localStorage.setItem("xuanjian.leftWidth", String(next));
    }
    set({ leftWidth: next });
  },
  setRightWidth: (w, opts) => {
    const next = clamp(w, RIGHT_MIN, RIGHT_MAX);
    if (opts?.persist !== false) {
      localStorage.setItem("xuanjian.rightWidth", String(next));
    }
    set({ rightWidth: next });
  },
  setSwitcherOpen: (open) => set({ switcherOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    })),
  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const closing = tabs.find((t) => t.id === id);
    void import("../lib/sessionRecorder").then(({ endRecordingForTab }) =>
      endRecordingForTab(id),
    );
    if (closing?.sessionId) {
      api.sessionClose(closing.sessionId).catch(() => undefined);
    }
    const next = tabs.filter((t) => t.id !== id);
    const active =
      activeTabId === id ? next[next.length - 1]?.id ?? null : activeTabId;
    set({ tabs: next, activeTabId: active });
  },
  setActiveTab: (id) => set({ activeTabId: id }),
  setHostFilter: (patch) =>
    set((s) => ({ hostFilter: { ...s.hostFilter, ...patch } })),
}));
