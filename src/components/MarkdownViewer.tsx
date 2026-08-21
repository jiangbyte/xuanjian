/**
 * @file Markdown 预览封装
 * @author Charlie
 * @description 基于 @uiw/react-markdown-preview，跟随应用主题。
 */

import MarkdownPreview from "@uiw/react-markdown-preview";
import "@uiw/react-markdown-preview/markdown.css";
import { cn } from "@/lib/utils";
import { resolveMarkdownColorMode, useSettingsStore } from "@/stores/settings";

/**
 * 只读 Markdown 渲染（GFM / 代码高亮等由 uiw 包提供）。
 */
export function MarkdownViewer({
  source,
  className,
  emptyHint,
}: {
  source: string;
  className?: string;
  emptyHint?: string;
}) {
  const markdownColorMode = useSettingsStore((s) => s.markdownColorMode);
  const theme = useSettingsStore((s) => s.theme);
  const colorMode = resolveMarkdownColorMode(markdownColorMode);
  void theme;

  const trimmed = source.trim();

  return (
    <div
      className={cn("md-preview-wrap min-h-0 flex-1 overflow-auto", className)}
      data-color-mode={colorMode}
    >
      {trimmed ? (
        <MarkdownPreview
          source={source}
          className="!bg-transparent px-4 py-3 text-[15px] leading-relaxed"
          wrapperElement={{ "data-color-mode": colorMode }}
        />
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyHint || "…"}
        </p>
      )}
    </div>
  );
}
