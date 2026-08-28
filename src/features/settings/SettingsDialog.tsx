/**
 * @file 应用设置弹窗
 * @author Charlie
 * @description 外观、终端、编辑器、模型 / MCP / Agent、数据与关于等偏好。
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AppWindow,
  Archive,
  Bot,
  Cable,
  Code2,
  FolderOpen,
  HardDrive,
  Info,
  Puzzle,
  Sparkles,
  Terminal,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AgentSettingsSection } from "@/features/settings/AgentSettingsSection";
import { AgentsCatalogSettingsSection } from "@/features/settings/AgentsCatalogSettingsSection";
import { McpSettingsSection } from "@/features/settings/McpSettingsSection";
import { ModelsSettingsSection } from "@/features/settings/ModelsSettingsSection";
import { PluginsToolsSettingsSection } from "@/features/settings/PluginsToolsSettingsSection";
import { KnownHostsSection } from "@/features/settings/KnownHostsSection";
import {
  DEFAULT_EXPORT_ALL,
  ShareExportDialog,
} from "@/features/share/ShareExportDialog";
import i18n from "@/i18n";
import {
  APP_AUTHOR,
  APP_GITHUB_ISSUES_URL,
  APP_GITHUB_URL,
  APP_ID,
  APP_LICENSE,
  APP_NAME,
  APP_NAME_EN,
  APP_RELEASES_URL,
  APP_VERSION,
} from "@/lib/core/appMeta";
import { getSetting, setSetting } from "@/lib/db";
import { formatImportToast, importFromFile } from "@/lib/share";
import { selectionNav } from "@/lib/core/selection";
import { api, type DataDirInfo, LocalShellInfo } from "@/lib/tauri";
import {
  EDITOR_FONT_MAX,
  EDITOR_FONT_MIN,
  EditorPreviewMode,
  EditorThemeMode,
  TERM_FONT_FAMILIES,
  TERM_FONT_MAX,
  TERM_FONT_MIN,
  ThemeMode,
  resolveTermFontFamily,
  useSettingsStore,
} from "@/stores/settings";

type SectionId =
  | "appearance"
  | "terminal"
  | "editor"
  | "models"
  | "plugins"
  | "mcp"
  | "agents"
  | "agent"
  | "data"
  | "backup"
  | "about";

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
      <div className="mb-1.5 text-sm font-medium text-foreground">{label}</div>
      {hint ? (
        <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {children}
    </div>
  );
}

/** 应用设置弹窗 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("appearance");
  const [shells, setShells] = useState<LocalShellInfo[]>([]);
  const [dataInfo, setDataInfo] = useState<DataDirInfo | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [backupExportOpen, setBackupExportOpen] = useState(false);

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
    api.getDataDirInfo().then(setDataInfo).catch(console.error);
    (async () => {
      const themeVal = (await getSetting("theme")) as ThemeMode | null;
      const localeVal = await getSetting("locale");
      const shellVal = await getSetting("default_local_shell");
      const termSize = await getSetting("term_font_size");
      const termFamily = await getSetting("term_font_family");
      const resolvedTermFamily = resolveTermFontFamily(
        termFamily ?? useSettingsStore.getState().termFontFamily,
      );
      if (!termFamily?.trim()) {
        await setSetting("term_font_family", resolvedTermFamily);
      }
      const edSize = await getSetting("editor_font_size");
      const edWrap = await getSetting("editor_word_wrap");
      const edTheme = (await getSetting(
        "editor_theme",
      )) as EditorThemeMode | null;
      const mdMode = (await getSetting(
        "markdown_color_mode",
      )) as EditorPreviewMode | null;
      useSettingsStore.getState().hydrate({
        theme: themeVal || "system",
        locale: localeVal || "zh-CN",
        defaultLocalShell: shellVal || "",
        termFontSize: termSize ? Number(termSize) : undefined,
        termFontFamily: resolvedTermFamily,
        editorFontSize: edSize ? Number(edSize) : undefined,
        editorWordWrap:
          edWrap == null ? undefined : edWrap === "1" || edWrap === "true",
        editorTheme: edTheme || "vs-dark",
        markdownColorMode: mdMode || "follow",
      });
      if (localeVal) i18n.changeLanguage(localeVal);
    })().catch(console.error);
  }, [open]);

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
    {
      id: "models",
      label: t("settings.models"),
      icon: <Sparkles size={15} />,
    },
    {
      id: "plugins",
      label: t("settings.pluginsTools"),
      icon: <Puzzle size={15} />,
    },
    {
      id: "mcp",
      label: t("settings.mcp"),
      icon: <Cable size={15} />,
    },
    {
      id: "agents",
      label: t("settings.agentsCatalog"),
      icon: <Bot size={15} />,
    },
    {
      id: "agent",
      label: t("settings.agent"),
      icon: <Bot size={15} />,
    },
    {
      id: "data",
      label: t("settings.data"),
      icon: <HardDrive size={15} />,
    },
    {
      id: "backup",
      label: t("settings.backup"),
      icon: <Archive size={15} />,
    },
    {
      id: "about",
      label: t("settings.about"),
      icon: <Info size={15} />,
    },
  ];

  const changeDataDir = async (path: string | null) => {
    setDataBusy(true);
    setDataMsg(null);
    try {
      const copy = window.confirm(t("settings.dataCopyConfirm"));
      const info = await api.setDataDir(path, copy);
      setDataInfo(info);
      setDataMsg(t("settings.dataRestartHint"));
    } catch (e) {
      setDataMsg(String(e));
    } finally {
      setDataBusy(false);
    }
  };

  const pickDataDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string" && dir) {
      await changeDataDir(dir);
    }
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[min(720px,88vh)] max-h-[88vh] w-[min(920px,calc(100vw-2rem))] max-w-[920px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px] rounded-none"
      >
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/20">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold tracking-tight">
                {t("settings.title")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.pageHint")}
              </p>
            </div>
            <nav className="flex flex-1 flex-col gap-0 overflow-y-auto p-2">
              {nav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={selectionNav(
                    section === item.id,
                    "flex w-full items-center gap-2.5 px-2.5 py-2 text-sm text-foreground hover:bg-muted",
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

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl p-5 md:p-6">
              {section === "appearance" && (
                <section>
                  <h3 className="mb-4 text-base font-semibold tracking-tight">
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
                          variant="outline"
                          className={
                            theme === value
                              ? "border-border bg-accent font-medium text-accent-foreground hover:bg-accent"
                              : undefined
                          }
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
                  <KnownHostsSection />
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

              {section === "models" && <ModelsSettingsSection />}
              {section === "plugins" && <PluginsToolsSettingsSection />}
              {section === "mcp" && <McpSettingsSection />}
              {section === "agents" && <AgentsCatalogSettingsSection />}
              {section === "agent" && <AgentSettingsSection />}

              {section === "data" && (
                <section>
                  <h3 className="mb-4 text-base font-semibold">
                    {t("settings.data")}
                  </h3>
                  <SettingRow
                    label={t("settings.dataDir")}
                    hint={t("settings.dataDirHint")}
                  >
                    <div className="border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
                      {dataInfo?.dataDir ?? "…"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dataInfo?.isCustom
                        ? t("settings.dataDirCustom")
                        : t("settings.dataDirDefault")}
                    </p>
                  </SettingRow>
                  <SettingRow label={t("settings.dbPath")}>
                    <div className="border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
                      {dataInfo?.dbPath ?? "…"}
                    </div>
                  </SettingRow>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={dataBusy}
                      onClick={() => pickDataDir().catch(console.error)}
                    >
                      <FolderOpen size={14} className="mr-1.5" />
                      {t("settings.dataChange")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={dataBusy || !dataInfo?.isCustom}
                      onClick={() => changeDataDir(null).catch(console.error)}
                    >
                      {t("settings.dataReset")}
                    </Button>
                  </div>
                  {dataMsg ? (
                    <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                      {dataMsg}
                    </p>
                  ) : null}
                </section>
              )}

              {section === "backup" && (
                <section>
                  <h3 className="mb-4 text-base font-semibold">
                    {t("settings.backup")}
                  </h3>
                  <SettingRow
                    label={t("settings.backup")}
                    hint={t("settings.backupHint")}
                  >
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => setBackupExportOpen(true)}
                      >
                        {t("settings.backupExport")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          importFromFile()
                            .then((r) => {
                              if (!r) return;
                              toast.success(
                                `${t("share.importDone")} (${formatImportToast(r)})`,
                              );
                              if (r.errors.length) console.warn(r.errors);
                            })
                            .catch((e) => toast.error(String(e)));
                        }}
                      >
                        {t("settings.backupImport")}
                      </Button>
                    </div>
                  </SettingRow>
                </section>
              )}

              {section === "about" && (
                <section>
                  <h3 className="mb-4 text-base font-semibold">
                    {t("settings.about")}
                  </h3>
                  <div className="mb-5 flex items-start gap-4">
                    <img
                      src="/app-icon.png?v=20260821d"
                      alt=""
                      className="size-14 shrink-0 rounded-xl border border-border bg-background p-1"
                      width={56}
                      height={56}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold tracking-tight">
                          {APP_NAME}
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            {APP_NAME_EN}
                          </span>
                        </div>
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary">
                          v{APP_VERSION}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {t("settings.aboutDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="mb-5">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      {t("settings.aboutFeaturesTitle")}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        t("settings.aboutFeatureTerminal"),
                        t("settings.aboutFeatureAgent"),
                        t("settings.aboutFeatureSftp"),
                        t("settings.aboutFeatureNetwork"),
                        t("settings.aboutFeatureLocal"),
                      ].map((label) => (
                        <div
                          key={label}
                          className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-xs leading-snug text-foreground"
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <SettingRow label={t("settings.aboutVersion")}>
                    <div className="font-mono text-sm">v{APP_VERSION}</div>
                  </SettingRow>
                  <SettingRow label={t("settings.aboutTechStack")}>
                    <div className="text-sm text-muted-foreground">
                      {t("settings.aboutTechStackValue")}
                    </div>
                  </SettingRow>
                  <SettingRow label={t("settings.aboutAuthor")}>
                    <div className="text-sm">{APP_AUTHOR}</div>
                  </SettingRow>
                  <SettingRow label={t("settings.aboutLicense")}>
                    <div className="text-sm">{APP_LICENSE}</div>
                  </SettingRow>
                  <SettingRow label={t("settings.aboutAppId")}>
                    <div className="font-mono text-xs break-all text-muted-foreground">
                      {APP_ID}
                    </div>
                  </SettingRow>
                  <SettingRow
                    label={t("settings.aboutRepo")}
                    hint={t("settings.aboutRepoHint")}
                  >
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openUrl(APP_GITHUB_URL).catch(console.error)
                        }
                      >
                        GitHub
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openUrl(APP_RELEASES_URL).catch(console.error)
                        }
                      >
                        {t("settings.aboutReleases")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openUrl(APP_GITHUB_ISSUES_URL).catch(console.error)
                        }
                      >
                        {t("settings.aboutIssues")}
                      </Button>
                    </div>
                    <p className="mt-2 font-mono text-xs break-all text-muted-foreground">
                      {APP_GITHUB_URL}
                    </p>
                  </SettingRow>
                </section>
              )}
            </div>
          </div>
        </div>
        <ShareExportDialog
          open={backupExportOpen}
          onOpenChange={setBackupExportOpen}
          defaults={DEFAULT_EXPORT_ALL}
        />
      </DialogContent>
    </Dialog>
  );
}
