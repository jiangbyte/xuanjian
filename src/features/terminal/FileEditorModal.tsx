import { api } from "../../lib/tauri";
import { FloatingWindow } from "../../components/FloatingWindow";
import { useTranslation } from "react-i18next";
import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import {
  resolveMonacoTheme,
  useSettingsStore,
} from "../../stores/settings";

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

export type FileEditorTarget = {
  path: string;
  remote: boolean;
  sessionId: string | null;
};

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const text =
          target.remote && target.sessionId
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
      if (target.remote && target.sessionId) {
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
        <button
          className="btn btn-sm btn-primary"
          disabled={saving || loading || !!error}
          onClick={save}
        >
          {saving ? t("terminal.saving") : t("terminal.save")}
        </button>
      }
    >
      {error && (
        <div className="border-b border-[var(--border)] px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm muted">
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
