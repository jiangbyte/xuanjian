/**
 * @file UI 布局与终端标签 Store
 * @author Charlie
 * @description 左右侧栏折叠/宽度、传输面板开关、会话标签与主机筛选。
 * 宽度持久化到 localStorage；关标签会结束录制并关闭后端 session。
 */

import { create } from "zustand";
import { api } from "@/lib/tauri";

/** 终端标签元数据（不含 xterm 实例） */
export type TermTab = {
  id: string;
  title: string;
  kind: "local" | "ssh";
  sessionId: string | null;
  hostId?: number;
  /** 本地 shell id，用于重连（PowerShell / cmd / bash …） */
  shellId?: string;
  /** 录制中的 session_logs 行 id */
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

/**
 * UI Zustand store。
 * @副作用 closeTab 结束录制并 `api.sessionClose`；宽度 setter 默认可持久化
 */
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
    const sessionId = closing?.sessionId ?? null;
    const logId = closing?.logId;
    // 先收尾录制（带上 sessionId/logId，避免删 tab 后找不到）
    void import("@/lib/sessionRecorder").then(async (rec) => {
      if (sessionId) {
        await rec.endSessionRecording(sessionId, "closed");
      } else {
        await rec.endRecordingForTab(id);
      }
      if (logId != null) {
        try {
          const { finalizeSessionLog } = await import("@/lib/db");
          await finalizeSessionLog(logId, "closed");
        } catch {
          /* 可能已 finalize */
        }
      }
    });
    if (sessionId) {
      api.sessionClose(sessionId).catch(() => undefined);
    }
    const next = tabs.filter((t) => t.id !== id);
    const active =
      activeTabId === id ? (next[next.length - 1]?.id ?? null) : activeTabId;
    set({ tabs: next, activeTabId: active });
  },
  setActiveTab: (id) => set({ activeTabId: id }),
  setHostFilter: (patch) =>
    set((s) => ({ hostFilter: { ...s.hostFilter, ...patch } })),
}));
