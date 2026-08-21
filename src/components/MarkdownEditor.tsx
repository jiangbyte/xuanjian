/**
 * @file Markdown 编辑器封装
 * @author Charlie
 * @description 基于 @uiw/react-md-editor，跟随应用主题的明暗色模式。
 * 供笔记等场景复用；不负责持久化。
 */

import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import { resolveMarkdownColorMode, useSettingsStore } from "@/stores/settings";

/**
 * Markdown 所见即所得编辑器。
 * @param value 当前 Markdown 文本
 * @param onChange 内容变更回调
 * @param height 编辑器高度，默认铺满父容器
 * @param preview 预览模式：live / edit / preview
 * @param hideToolbar 是否隐藏工具栏
 */
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
  // 主题为 follow 时，应用主题变化需触发重新解析
  void theme;

  const fillParent = height == null || height === "100%";

  return (
    <div
      className={
        fillParent
          ? "md-editor-wrap relative min-h-0 flex-1 overflow-hidden"
          : "md-editor-wrap overflow-hidden"
      }
      data-color-mode={colorMode}
    >
      <div className={fillParent ? "absolute inset-0" : undefined}>
        <MDEditor
          value={value}
          onChange={(v) => onChange(v ?? "")}
          height={fillParent ? "100%" : height}
          preview={preview}
          hideToolbar={hideToolbar}
          visibleDragbar={false}
          textareaProps={{
            placeholder: "支持 Markdown…",
          }}
        />
      </div>
    </div>
  );
}
