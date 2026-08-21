import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import {
  resolveMarkdownColorMode,
  useSettingsStore,
} from "../stores/settings";

export function MarkdownEditor({
  value,
  onChange,
  height,
  preview = "live",
  hideToolbar = false,
}: {
  value: string;
  onChange: (value: string) => void;
  height?: number | string;
  preview?: "live" | "edit" | "preview";
  hideToolbar?: boolean;
}) {
  const markdownColorMode = useSettingsStore((s) => s.markdownColorMode);
  const theme = useSettingsStore((s) => s.theme);
  const colorMode = resolveMarkdownColorMode(markdownColorMode);
  // Re-resolve when app theme changes while mode is "follow".
  void theme;

  return (
    <div
      className="md-editor-wrap min-h-0 flex-1 overflow-hidden"
      data-color-mode={colorMode}
    >
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        height={height ?? "100%"}
        preview={preview}
        hideToolbar={hideToolbar}
        visibleDragbar={false}
        textareaProps={{
          placeholder: "支持 Markdown…",
        }}
      />
    </div>
  );
}
