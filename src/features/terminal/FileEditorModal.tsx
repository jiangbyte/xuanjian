/**
 * @file 文件编辑器浮窗
 * @author Charlie
 * @description 用 Monaco 编辑本地或 SFTP 远程文件，支持按扩展名推断语言。
 * 打开时读取内容，保存时写回本地或远程；脏标记显示在标题前。
 * 主题与字号等跟随设置 store。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FloatingWindow } from "@/components/FloatingWindow";
import Editor from "@/components/MonacoEditor";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/tauri";
import { resolveMonacoTheme, useSettingsStore } from "@/stores/settings";

/** 根据路径扩展名推断 Monaco language id */
function languageFromPath(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    rs: "rust",
    py: "python",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "cpp",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    bash: "shell",
    ps1: "powershell",
    sql: "sql",
    toml: "ini",
    ini: "ini",
    conf: "ini",
    log: "plaintext",
    txt: "plaintext",
  };
  return map[ext] || "plaintext";
}

/** 编辑目标：路径 + 是否远程 + 可选会话 ID */
export type FileEditorTarget = {
  path: string;
  remote: boolean;
  /** WSL 内文件（走 wsl_* 而非 SFTP） */
  wsl?: boolean;
  sessionId: string | null;
};

/**
 * Monaco 文件编辑浮窗：加载、编辑、保存本地或 SFTP 文件。
 */
export function FileEditorModal({
  target,
  onClose,
  onSaved,
}: {
  target: FileEditorTarget;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== original;
  const language = useMemo(() => languageFromPath(target.path), [target.path]);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const appTheme = useSettingsStore((s) => s.theme);
  const monacoTheme = resolveMonacoTheme(editorTheme);
  void appTheme;

  // —— 加载文件内容 ——
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const text =
          target.wsl && target.sessionId
            ? await api.wslReadFile(target.sessionId, target.path)
            : target.remote && target.sessionId
              ? await api.sftpRead(target.sessionId, target.path)
              : await api.readLocalFile(target.path);
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (target.wsl && target.sessionId) {
        await api.wslWriteFile(target.sessionId, target.path, content);
      } else if (target.remote && target.sessionId) {
        await api.sftpWrite(target.sessionId, target.path, content);
      } else {
        await api.writeLocalFile(target.path, content);
      }
      setOriginal(content);
      onSaved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FloatingWindow
      title={`${dirty ? "• " : ""}${target.path}`}
      onClose={onClose}
      initialWidth={920}
      initialHeight={640}
      bodyClassName="flex flex-col overflow-hidden p-0"
      headerActions={
        <Button
          size="xs"
          disabled={saving || loading || !!error}
          onClick={save}
        >
          {saving ? t("terminal.saving") : t("terminal.save")}
        </Button>
      }
    >
      {error && (
        <div className="border-b border-border px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("terminal.loading")}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={language}
            theme={monacoTheme}
            value={content}
            onChange={(v) => setContent(v ?? "")}
            options={{
              fontSize: editorFontSize,
              minimap: { enabled: true },
              wordWrap: editorWordWrap ? "on" : "off",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              tabSize: 2,
            }}
          />
        </div>
      )}
    </FloatingWindow>
  );
}
