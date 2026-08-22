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
  density = "default",
}: {
  source: string;
  className?: string;
  emptyHint?: string;
  /** compact：侧栏对话等窄区域 — 标题与正文同级，避免忽大忽小 */
  density?: "default" | "compact";
}) {
  const markdownColorMode = useSettingsStore((s) => s.markdownColorMode);
  const theme = useSettingsStore((s) => s.theme);
  const colorMode = resolveMarkdownColorMode(markdownColorMode);
  void theme;

  const trimmed = source.trim();
  const compact = density === "compact";

  return (
    <div
      className={cn(
        "md-preview-wrap min-h-0 overflow-auto",
        !compact && "flex-1",
        compact && "xj-md-chat",
        className,
      )}
      data-color-mode={colorMode}
    >
      {trimmed ? (
        <MarkdownPreview
          source={source}
          className={cn(
            "!bg-transparent leading-relaxed",
            compact
              ? [
                  "!px-0 !py-0 text-[12px] leading-[1.55]",
                  // 标题压到与正文同量级，仅用字重区分
                  "[&_h1]:!m-0 [&_h1]:!mb-1.5 [&_h1]:!mt-2 [&_h1]:!border-0 [&_h1]:!pb-0",
                  "[&_h1]:!text-[12px] [&_h1]:!font-semibold [&_h1]:!leading-[1.55]",
                  "[&_h2]:!m-0 [&_h2]:!mb-1.5 [&_h2]:!mt-2 [&_h2]:!border-0 [&_h2]:!pb-0",
                  "[&_h2]:!text-[12px] [&_h2]:!font-semibold [&_h2]:!leading-[1.55]",
                  "[&_h3]:!m-0 [&_h3]:!mb-1 [&_h3]:!mt-1.5 [&_h3]:!text-[12px] [&_h3]:!font-semibold",
                  "[&_h4]:!m-0 [&_h4]:!mb-1 [&_h4]:!mt-1.5 [&_h4]:!text-[12px] [&_h4]:!font-medium",
                  "[&_h5]:!m-0 [&_h5]:!text-[12px] [&_h5]:!font-medium",
                  "[&_h6]:!m-0 [&_h6]:!text-[12px] [&_h6]:!font-medium",
                  "[&_p]:!my-1 [&_p]:!text-[12px] [&_p]:!leading-[1.55]",
                  "[&_li]:!my-0 [&_li]:!text-[12px] [&_li]:!leading-[1.55]",
                  "[&_ul]:!my-1 [&_ul]:!pl-4 [&_ol]:!my-1 [&_ol]:!pl-4",
                  "[&_blockquote]:!my-1 [&_blockquote]:!py-0.5 [&_blockquote]:!text-[12px]",
                  "[&_hr]:!my-2",
                  // 表格：窄栏可读
                  "[&_table]:!my-1.5 [&_table]:!block [&_table]:!w-full [&_table]:!overflow-x-auto",
                  "[&_table]:!text-[11px] [&_table]:!leading-snug",
                  "[&_th]:!px-1.5 [&_th]:!py-1 [&_th]:!font-medium",
                  "[&_td]:!px-1.5 [&_td]:!py-1",
                  "[&_pre]:!my-1.5 [&_pre]:!rounded-md [&_pre]:!p-2 [&_pre]:!text-[11px]",
                  "[&_code]:!text-[11px]",
                  "[&_pre_code]:!text-[11px]",
                  "[&_strong]:!font-semibold",
                ].join(" ")
              : "px-4 py-3 text-[15px]",
          )}
          wrapperElement={{ "data-color-mode": colorMode }}
        />
      ) : (
        <p
          className={cn(
            "text-center text-muted-foreground",
            compact ? "px-2 py-4 text-xs" : "px-4 py-8 text-sm",
          )}
        >
          {emptyHint || "…"}
        </p>
      )}
    </div>
  );
}
