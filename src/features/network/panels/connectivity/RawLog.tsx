/**
 * @file 连通性原始输出（主区域）
 * @author Charlie
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** 原文日志区：占满父级高度并自动滚到底 */
export function RawLog({ lines, busy }: { lines: string[]; busy: boolean }) {
  const { t } = useTranslation();
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {t("network.rawOutput")}
      </div>
      <pre
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto bg-card p-3 font-mono text-xs leading-relaxed"
      >
        {lines.length ? lines.join("\n") : busy ? t("network.running") : ""}
      </pre>
    </div>
  );
}
