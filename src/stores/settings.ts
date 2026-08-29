/**
 * @file 应用外观与编辑器设置 Store
 * @author Charlie
 * @description 主题、语言、终端/编辑器字体与 Markdown 色模式。
 * 多数项同步 localStorage；`hydrate` 可从 DB 覆盖。模块加载时立即 applyTheme。
 */

import { startTransition } from "react";
import { create } from "zustand";
import {
  resolveTermBellMode,
  type TermBellMode,
} from "@/lib/ui/terminalBell";

/** 应用主题：亮 / 暗 / 跟随系统 */
export type ThemeMode = "light" | "dark" | "system";

/** Monaco / 代码编辑器主题偏好 */
export type EditorThemeMode = "follow" | "vs-dark" | "light" | "hc-black";

/** Markdown 预览色模式 */
export type EditorPreviewMode = "follow" | "dark" | "light";

export type { TermBellMode };

const TERM_FONT_MIN = 10;
const TERM_FONT_MAX = 28;
const EDITOR_FONT_MIN = 11;
const EDITOR_FONT_MAX = 24;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readNum(key: string, fallback: number) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) ? v : fallback;
}

function readBool(key: string, fallback: boolean) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "1" || v === "true";
}

type SettingsState = {
  theme: ThemeMode;
  locale: string;
  defaultLocalShell: string;
  termFontSize: number;
  termFontFamily: string;
  termBellMode: TermBellMode;
  editorFontSize: number;
  editorWordWrap: boolean;
  editorTheme: EditorThemeMode;
  markdownColorMode: EditorPreviewMode;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
  setDefaultLocalShell: (id: string) => void;
  setTermFontSize: (size: number) => void;
  setTermFontFamily: (family: string) => void;
  setTermBellMode: (mode: TermBellMode) => void;
  setEditorFontSize: (size: number) => void;
  setEditorWordWrap: (wrap: boolean) => void;
  setEditorTheme: (theme: EditorThemeMode) => void;
  setMarkdownColorMode: (mode: EditorPreviewMode) => void;
  hydrate: (
    data: Partial<
      Pick<
        SettingsState,
        | "theme"
        | "locale"
        | "defaultLocalShell"
        | "termFontSize"
        | "termFontFamily"
        | "termBellMode"
        | "editorFontSize"
        | "editorWordWrap"
        | "editorTheme"
        | "markdownColorMode"
      >
    >,
  ) => void;
};

/**
 * 将主题应用到 documentElement，并写入 localStorage。
 * @param theme light / dark / system
 * @副作用 切换 `.light` / `.dark` class
 */
export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  root.classList.remove("light");
  localStorage.setItem("xuanjian.theme", theme);
}

/** 当前是否为暗色应用主题（看 documentElement class） */
export function isAppDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * 根据设置解析 Monaco 主题 id。
 * @param mode 默认取 store 中的 editorTheme；follow 时跟随应用明暗
 */
export function resolveMonacoTheme(
  mode: EditorThemeMode = useSettingsStore.getState().editorTheme,
): string {
  if (mode === "follow") return isAppDark() ? "vs-dark" : "light";
  return mode;
}

/**
 * 根据设置解析 Markdown 编辑器 color-mode。
 * @param mode 默认取 store；follow 时跟随应用明暗
 */
export function resolveMarkdownColorMode(
  mode: EditorPreviewMode = useSettingsStore.getState().markdownColorMode,
): "dark" | "light" {
  if (mode === "follow") return isAppDark() ? "dark" : "light";
  return mode;
}

/** 可选终端字体族列表（id 为 CSS font-family 串） */
export const TERM_FONT_FAMILIES = [
  {
    id: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    label: "Consolas",
  },
  {
    id: '"Cascadia Mono", Consolas, monospace',
    label: "Cascadia Mono",
  },
  {
    id: '"JetBrains Mono", Consolas, monospace',
    label: "JetBrains Mono",
  },
  {
    id: '"Fira Code", Consolas, monospace',
    label: "Fira Code",
  },
  {
    id: '"Sarasa Mono SC", "Sarasa Term SC", Consolas, monospace',
    label: "更纱黑体 Mono",
  },
  {
    id: 'Menlo, Monaco, "Courier New", monospace',
    label: "Menlo / Monaco",
  },
] as const;

/** 默认终端字体（与 TERM_FONT_FAMILIES 首项一致） */
export const DEFAULT_TERM_FONT_FAMILY = TERM_FONT_FAMILIES[0].id;

/** 将存储值规范为已知字体 id，无效时回退默认 */
export function resolveTermFontFamily(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_TERM_FONT_FAMILY;
  const known = TERM_FONT_FAMILIES.find((f) => f.id === trimmed);
  return known?.id ?? DEFAULT_TERM_FONT_FAMILY;
}

/**
 * 设置 Zustand store；setter 多数会同步 localStorage。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  theme: (localStorage.getItem("xuanjian.theme") as ThemeMode) || "system",
  locale: localStorage.getItem("xuanjian.locale") || "zh-CN",
  defaultLocalShell: "",
  termFontSize: clamp(
    readNum("xuanjian.termFontSize", 14),
    TERM_FONT_MIN,
    TERM_FONT_MAX,
  ),
  termFontFamily: resolveTermFontFamily(
    localStorage.getItem("xuanjian.termFontFamily"),
  ),
  termBellMode: resolveTermBellMode(
    localStorage.getItem("xuanjian.termBellMode"),
  ),
  editorFontSize: clamp(
    readNum("xuanjian.editorFontSize", 12),
    EDITOR_FONT_MIN,
    EDITOR_FONT_MAX,
  ),
  editorWordWrap: readBool("xuanjian.editorWordWrap", true),
  editorTheme:
    (localStorage.getItem("xuanjian.editorTheme") as EditorThemeMode) ||
    "vs-dark",
  markdownColorMode:
    (localStorage.getItem("xuanjian.markdownColorMode") as EditorPreviewMode) ||
    "follow",
  setTheme: (theme) => {
    applyTheme(theme);
    startTransition(() => set({ theme }));
  },
  setLocale: (locale) => {
    localStorage.setItem("xuanjian.locale", locale);
    set({ locale });
  },
  setDefaultLocalShell: (id) => set({ defaultLocalShell: id }),
  setTermFontSize: (size) => {
    const next = clamp(Math.round(size), TERM_FONT_MIN, TERM_FONT_MAX);
    localStorage.setItem("xuanjian.termFontSize", String(next));
    set({ termFontSize: next });
  },
  setTermFontFamily: (family) => {
    const next = resolveTermFontFamily(family);
    localStorage.setItem("xuanjian.termFontFamily", next);
    set({ termFontFamily: next });
  },
  setTermBellMode: (mode) => {
    const next = resolveTermBellMode(mode);
    localStorage.setItem("xuanjian.termBellMode", next);
    set({ termBellMode: next });
  },
  setEditorFontSize: (size) => {
    const next = clamp(Math.round(size), EDITOR_FONT_MIN, EDITOR_FONT_MAX);
    localStorage.setItem("xuanjian.editorFontSize", String(next));
    set({ editorFontSize: next });
  },
  setEditorWordWrap: (wrap) => {
    localStorage.setItem("xuanjian.editorWordWrap", wrap ? "1" : "0");
    set({ editorWordWrap: wrap });
  },
  setEditorTheme: (theme) => {
    localStorage.setItem("xuanjian.editorTheme", theme);
    set({ editorTheme: theme });
  },
  setMarkdownColorMode: (mode) => {
    localStorage.setItem("xuanjian.markdownColorMode", mode);
    set({ markdownColorMode: mode });
  },
  /** 用外部数据（如 DB）合并覆盖当前设置 */
  hydrate: (data) => {
    if (data.theme) applyTheme(data.theme);
    set((s) => {
      const termFontFamily =
        data.termFontFamily != null && data.termFontFamily.trim() !== ""
          ? resolveTermFontFamily(data.termFontFamily)
          : s.termFontFamily;
      const termBellMode =
        data.termBellMode != null
          ? resolveTermBellMode(data.termBellMode)
          : s.termBellMode;

      if (data.termFontFamily != null && data.termFontFamily.trim() !== "") {
        localStorage.setItem("xuanjian.termFontFamily", termFontFamily);
      }
      if (data.termBellMode != null) {
        localStorage.setItem("xuanjian.termBellMode", termBellMode);
      }

      return {
        ...s,
        ...data,
        termFontFamily,
        termBellMode,
        termFontSize:
          data.termFontSize != null
            ? clamp(data.termFontSize, TERM_FONT_MIN, TERM_FONT_MAX)
            : s.termFontSize,
        editorFontSize:
          data.editorFontSize != null
            ? clamp(data.editorFontSize, EDITOR_FONT_MIN, EDITOR_FONT_MAX)
            : s.editorFontSize,
      };
    });
  },
}));

applyTheme((localStorage.getItem("xuanjian.theme") as ThemeMode) || "system");

export { EDITOR_FONT_MAX, EDITOR_FONT_MIN, TERM_FONT_MAX, TERM_FONT_MIN };
