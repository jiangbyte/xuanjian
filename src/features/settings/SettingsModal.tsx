/**
 * @file 应用设置浮窗
 * @author Charlie
 * @description 外观（主题/语言/默认 Shell）、终端字体与编辑器主题等偏好的读写界面。
 * 变更同步到 zustand store 与本地 settings 表。
 */

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppWindow, Code2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  useSettingsStore,
  ThemeMode,
  EditorThemeMode,
  EditorPreviewMode,
  TERM_FONT_FAMILIES,
  TERM_FONT_MIN,
  TERM_FONT_MAX,
  EDITOR_FONT_MIN,
  EDITOR_FONT_MAX,
} from "@/stores/settings";
import { getSetting, setSetting } from "@/lib/db";
import { api, LocalShellInfo } from "@/lib/tauri";
import { useUiStore } from "@/stores/ui";
import { FloatingWindow } from "@/components/FloatingWindow";
import i18n from "@/i18n";

type SectionId = "appearance" | "terminal" | "editor";

const SYSTEM_SHELL = "none";

/** 设置项标签 + 可选说明 + 控件 */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {hint ? (
        <p className="mb-2 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
      {children}
    </div>
  );
}

/** 应用设置模态框 */
export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("appearance");
  const [shells, setShells] = useState<LocalShellInfo[]>([]);

  const theme = useSettingsStore((s) => s.theme);
  const locale = useSettingsStore((s) => s.locale);
  const defaultLocalShell = useSettingsStore((s) => s.defaultLocalShell);
  const termFontSize = useSettingsStore((s) => s.termFontSize);
  const termFontFamily = useSettingsStore((s) => s.termFontFamily);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const markdownColorMode = useSettingsStore((s) => s.markdownColorMode);

  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setDefaultLocalShell = useSettingsStore((s) => s.setDefaultLocalShell);
  const setTermFontSize = useSettingsStore((s) => s.setTermFontSize);
  const setTermFontFamily = useSettingsStore((s) => s.setTermFontFamily);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const setEditorWordWrap = useSettingsStore((s) => s.setEditorWordWrap);
  const setEditorTheme = useSettingsStore((s) => s.setEditorTheme);
  const setMarkdownColorMode = useSettingsStore((s) => s.setMarkdownColorMode);

  useEffect(() => {
    if (!open) return;
    api.listLocalShells().then(setShells).catch(console.error);
    (async () => {
      const themeVal = (await getSetting("theme")) as ThemeMode | null;
      const localeVal = await getSetting("locale");
      const shellVal = await getSetting("default_local_shell");
      const termSize = await getSetting("term_font_size");
      const termFamily = await getSetting("term_font_family");
      const edSize = await getSetting("editor_font_size");
      const edWrap = await getSetting("editor_word_wrap");
      const edTheme = (await getSetting(
        "editor_theme",
      )) as EditorThemeMode | null;
      const mdMode = (await getSetting(
        "markdown_color_mode",
      )) as EditorPreviewMode | null;
      useSettingsStore.getState().hydrate({
        theme: themeVal || "dark",
        locale: localeVal || "zh-CN",
        defaultLocalShell: shellVal || "",
        termFontSize: termSize ? Number(termSize) : undefined,
        termFontFamily: termFamily || undefined,
        editorFontSize: edSize ? Number(edSize) : undefined,
        editorWordWrap:
          edWrap == null ? undefined : edWrap === "1" || edWrap === "true",
        editorTheme: edTheme || undefined,
        markdownColorMode: mdMode || undefined,
      });
      if (localeVal) i18n.changeLanguage(localeVal);
    })().catch(console.error);
  }, [open]);

  if (!open) return null;

  const nav: { id: SectionId; label: string; icon: ReactNode }[] = [
    {
      id: "appearance",
      label: t("settings.appearance"),
      icon: <AppWindow size={15} />,
    },
    {
      id: "terminal",
      label: t("settings.terminal"),
      icon: <Terminal size={15} />,
    },
    {
      id: "editor",
      label: t("settings.editor"),
      icon: <Code2 size={15} />,
    },
  ];

  const applyFontSize = async (
    n: string | number,
    setLocal: (v: number) => void,
    key: string,
  ) => {
    const value = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(value)) return;
    setLocal(value);
    await setSetting(key, String(value));
  };

  return (
    <FloatingWindow
      title={t("settings.title")}
      onClose={() => setSettingsOpen(false)}
      initialWidth={720}
      initialHeight={560}
      bodyClassName="p-0"
    >
      <div className="flex h-full min-h-0">
        <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-background">
          <div className="px-3 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.title")}
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
            {nav.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  section === item.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                )}
                onClick={() => setSection(item.id)}
              >
                <span className="flex items-center gap-2 truncate">
                  {item.icon}
                  {item.label}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {section === "appearance" && (
            <section>
              <h3 className="mb-4 text-base font-semibold">
                {t("settings.appearance")}
              </h3>
              <SettingRow label={t("settings.theme")}>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["light", t("settings.themeLight")],
                      ["system", t("settings.themeSystem")],
                      ["dark", t("settings.themeDark")],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      variant={theme === value ? "default" : "outline"}
                      onClick={async () => {
                        setTheme(value);
                        await setSetting("theme", value);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label={t("settings.language")}>
                <Select
                  value={locale}
                  onValueChange={async (value) => {
                    setLocale(value);
                    await i18n.changeLanguage(value);
                    await setSetting("locale", value);
                  }}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">简体中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow
                label={t("settings.defaultShell")}
                hint={t("settings.defaultShellHint")}
              >
                <Select
                  value={defaultLocalShell || SYSTEM_SHELL}
                  onValueChange={async (value) => {
                    const next = value === SYSTEM_SHELL ? "" : value;
                    setDefaultLocalShell(next);
                    await setSetting("default_local_shell", next);
                  }}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_SHELL}>
                      {t("settings.system")}
                    </SelectItem>
                    {shells.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </section>
          )}

          {section === "terminal" && (
            <section>
              <h3 className="mb-4 text-base font-semibold">
                {t("settings.terminal")}
              </h3>
              <SettingRow
                label={t("settings.termFont")}
                hint={t("settings.termFontHint")}
              >
                <Select
                  value={termFontFamily}
                  onValueChange={async (value) => {
                    setTermFontFamily(value);
                    await setSetting("term_font_family", value);
                  }}
                >
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TERM_FONT_FAMILIES.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label={t("settings.termFontSize")}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-[140px]"
                    value={termFontSize}
                    min={TERM_FONT_MIN}
                    max={TERM_FONT_MAX}
                    onChange={(e) =>
                      applyFontSize(
                        e.currentTarget.value,
                        setTermFontSize,
                        "term_font_size",
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground">px</span>
                </div>
              </SettingRow>
              <SettingRow
                label={t("settings.termWordWrap")}
                hint={t("settings.termWordWrapHint")}
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editorWordWrap}
                    aria-label={t("settings.termWordWrap")}
                    onCheckedChange={async (v) => {
                      setEditorWordWrap(v);
                      await setSetting("editor_word_wrap", v ? "1" : "0");
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {editorWordWrap
                      ? t("settings.wordWrapOn")
                      : t("settings.wordWrapOff")}
                  </span>
                </div>
              </SettingRow>
            </section>
          )}

          {section === "editor" && (
            <section>
              <h3 className="mb-4 text-base font-semibold">
                {t("settings.editor")}
              </h3>
              <SettingRow
                label={t("settings.editorTheme")}
                hint={t("settings.editorThemeHint")}
              >
                <Select
                  value={editorTheme}
                  onValueChange={async (value) => {
                    setEditorTheme(value as EditorThemeMode);
                    await setSetting("editor_theme", value);
                  }}
                >
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow">
                      {t("settings.editorThemeFollow")}
                    </SelectItem>
                    <SelectItem value="vs-dark">
                      {t("settings.editorThemeDark")}
                    </SelectItem>
                    <SelectItem value="light">
                      {t("settings.editorThemeLight")}
                    </SelectItem>
                    <SelectItem value="hc-black">
                      {t("settings.editorThemeHighContrast")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label={t("settings.editorFontSize")}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-[140px]"
                    value={editorFontSize}
                    min={EDITOR_FONT_MIN}
                    max={EDITOR_FONT_MAX}
                    onChange={(e) =>
                      applyFontSize(
                        e.currentTarget.value,
                        setEditorFontSize,
                        "editor_font_size",
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground">px</span>
                </div>
              </SettingRow>
              <SettingRow
                label={t("settings.markdownStyle")}
                hint={t("settings.markdownStyleHint")}
              >
                <Select
                  value={markdownColorMode}
                  onValueChange={async (value) => {
                    setMarkdownColorMode(value as EditorPreviewMode);
                    await setSetting("markdown_color_mode", value);
                  }}
                >
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow">
                      {t("settings.editorThemeFollow")}
                    </SelectItem>
                    <SelectItem value="dark">
                      {t("settings.themeDark")}
                    </SelectItem>
                    <SelectItem value="light">
                      {t("settings.themeLight")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
            </section>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
