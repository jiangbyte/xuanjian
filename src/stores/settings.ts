import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

/** Monaco / code editor theme preference. */
export type EditorThemeMode = "follow" | "vs-dark" | "light" | "hc-black";

export type EditorPreviewMode = "follow" | "dark" | "light";

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
  editorFontSize: number;
  editorWordWrap: boolean;
  editorTheme: EditorThemeMode;
  markdownColorMode: EditorPreviewMode;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
  setDefaultLocalShell: (id: string) => void;
  setTermFontSize: (size: number) => void;
  setTermFontFamily: (family: string) => void;
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
        | "editorFontSize"
        | "editorWordWrap"
        | "editorTheme"
        | "markdownColorMode"
      >
    >,
  ) => void;
};

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("light", !dark);
  root.classList.toggle("dark", dark);
  localStorage.setItem("xuanjian.theme", theme);
}

export function isAppDark(): boolean {
  return !document.documentElement.classList.contains("light");
}

/** Resolve Monaco theme id from settings. */
export function resolveMonacoTheme(
  mode: EditorThemeMode = useSettingsStore.getState().editorTheme,
): string {
  if (mode === "follow") return isAppDark() ? "vs-dark" : "light";
  return mode;
}

export function resolveMarkdownColorMode(
  mode: EditorPreviewMode = useSettingsStore.getState().markdownColorMode,
): "dark" | "light" {
  if (mode === "follow") return isAppDark() ? "dark" : "light";
  return mode;
}

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

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: (localStorage.getItem("xuanjian.theme") as ThemeMode) || "dark",
  locale: localStorage.getItem("xuanjian.locale") || "zh-CN",
  defaultLocalShell: "",
  termFontSize: clamp(readNum("xuanjian.termFontSize", 13), TERM_FONT_MIN, TERM_FONT_MAX),
  termFontFamily:
    localStorage.getItem("xuanjian.termFontFamily") ||
    TERM_FONT_FAMILIES[0].id,
  editorFontSize: clamp(
    readNum("xuanjian.editorFontSize", 13),
    EDITOR_FONT_MIN,
    EDITOR_FONT_MAX,
  ),
  editorWordWrap: readBool("xuanjian.editorWordWrap", true),
  editorTheme:
    (localStorage.getItem("xuanjian.editorTheme") as EditorThemeMode) ||
    "follow",
  markdownColorMode:
    (localStorage.getItem("xuanjian.markdownColorMode") as EditorPreviewMode) ||
    "follow",
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
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
    localStorage.setItem("xuanjian.termFontFamily", family);
    set({ termFontFamily: family });
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
  hydrate: (data) => {
    if (data.theme) applyTheme(data.theme);
    set((s) => ({
      ...s,
      ...data,
      termFontSize:
        data.termFontSize != null
          ? clamp(data.termFontSize, TERM_FONT_MIN, TERM_FONT_MAX)
          : s.termFontSize,
      editorFontSize:
        data.editorFontSize != null
          ? clamp(data.editorFontSize, EDITOR_FONT_MIN, EDITOR_FONT_MAX)
          : s.editorFontSize,
    }));
  },
}));

applyTheme((localStorage.getItem("xuanjian.theme") as ThemeMode) || "dark");

export { TERM_FONT_MIN, TERM_FONT_MAX, EDITOR_FONT_MIN, EDITOR_FONT_MAX };
