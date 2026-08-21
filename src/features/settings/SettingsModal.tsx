/**
 * @file 应用设置浮窗
 * @author Charlie
 * @description 外观（主题/语言/默认 Shell）、终端字体与编辑器主题等偏好的读写界面。
 * 变更同步到 zustand store 与本地 settings 表。
 */

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppWindow, Code2, Minus, Plus, Terminal } from "lucide-react";
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
import { Select } from "@/components/Select";
import i18n from "@/i18n";

type SectionId = "appearance" | "terminal" | "editor";

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
      {hint ? <p className="mb-2 text-[11px] muted">{hint}</p> : null}
      {children}
    </div>
  );
}

/** 数值加减步进器 */
function Stepper({
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="settings-stepper">
      <button
        type="button"
        className="settings-stepper-btn"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={14} />
      </button>
      <span className="settings-stepper-value">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        className="settings-stepper-btn"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

/** 开关切换控件 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`settings-switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-knob" />
    </button>
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

  return (
    <FloatingWindow
      title={t("settings.title")}
      onClose={() => setSettingsOpen(false)}
      initialWidth={720}
      initialHeight={560}
      bodyClassName="p-0"
    >
      <div className="flex h-full min-h-0">
        {/* —— 分区导航 —— */}
        <aside className="flex w-44 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
          <div className="settings-nav-label">{t("settings.title")}</div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
            {nav.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`list-row ${section === item.id ? "is-active" : ""}`}
                onClick={() => setSection(item.id)}
              >
                <span className="flex items-center gap-2 truncate text-sm">
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
                    <button
                      key={value}
                      className={theme === value ? "btn btn-primary" : "btn"}
                      onClick={async () => {
                        setTheme(value);
                        await setSetting("theme", value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label={t("settings.language")}>
                <Select
                  className="w-full max-w-xs"
                  value={locale}
                  options={[
                    { value: "zh-CN", label: "简体中文" },
                    { value: "en", label: "English" },
                  ]}
                  onChange={async (value) => {
                    setLocale(value);
                    await i18n.changeLanguage(value);
                    await setSetting("locale", value);
                  }}
                />
              </SettingRow>
              <SettingRow
                label={t("settings.defaultShell")}
                hint={t("settings.defaultShellHint")}
              >
                <Select
                  className="w-full max-w-xs"
                  value={defaultLocalShell}
                  options={[
                    { value: "", label: t("settings.system") },
                    ...shells.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  onChange={async (value) => {
                    setDefaultLocalShell(value);
                    await setSetting("default_local_shell", value);
                  }}
                />
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
                  className="w-full max-w-md"
                  value={termFontFamily}
                  options={TERM_FONT_FAMILIES.map((f) => ({
                    value: f.id,
                    label: f.label,
                  }))}
                  onChange={async (value) => {
                    setTermFontFamily(value);
                    await setSetting("term_font_family", value);
                  }}
                />
              </SettingRow>
              <SettingRow label={t("settings.termFontSize")}>
                <Stepper
                  value={termFontSize}
                  min={TERM_FONT_MIN}
                  max={TERM_FONT_MAX}
                  suffix="px"
                  onChange={async (n) => {
                    setTermFontSize(n);
                    await setSetting("term_font_size", String(n));
                  }}
                />
              </SettingRow>
              <SettingRow
                label={t("settings.termWordWrap")}
                hint={t("settings.termWordWrapHint")}
              >
                <div className="settings-switch-row">
                  <Toggle
                    checked={editorWordWrap}
                    label={t("settings.termWordWrap")}
                    onChange={async (v) => {
                      setEditorWordWrap(v);
                      await setSetting("editor_word_wrap", v ? "1" : "0");
                    }}
                  />
                  <span className="text-xs muted">
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
                  className="w-full max-w-md"
                  value={editorTheme}
                  options={[
                    { value: "follow", label: t("settings.editorThemeFollow") },
                    { value: "vs-dark", label: t("settings.editorThemeDark") },
                    { value: "light", label: t("settings.editorThemeLight") },
                    {
                      value: "hc-black",
                      label: t("settings.editorThemeHighContrast"),
                    },
                  ]}
                  onChange={async (value) => {
                    setEditorTheme(value as EditorThemeMode);
                    await setSetting("editor_theme", value);
                  }}
                />
              </SettingRow>
              <SettingRow label={t("settings.editorFontSize")}>
                <Stepper
                  value={editorFontSize}
                  min={EDITOR_FONT_MIN}
                  max={EDITOR_FONT_MAX}
                  suffix="px"
                  onChange={async (n) => {
                    setEditorFontSize(n);
                    await setSetting("editor_font_size", String(n));
                  }}
                />
              </SettingRow>
              <SettingRow
                label={t("settings.markdownStyle")}
                hint={t("settings.markdownStyleHint")}
              >
                <Select
                  className="w-full max-w-md"
                  value={markdownColorMode}
                  options={[
                    {
                      value: "follow",
                      label: t("settings.editorThemeFollow"),
                    },
                    { value: "dark", label: t("settings.themeDark") },
                    { value: "light", label: t("settings.themeLight") },
                  ]}
                  onChange={async (value) => {
                    setMarkdownColorMode(value as EditorPreviewMode);
                    await setSetting("markdown_color_mode", value);
                  }}
                />
              </SettingRow>
            </section>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
