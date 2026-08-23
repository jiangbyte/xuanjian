/**
 * @file 框选矩形叠加层
 * @author Charlie
 */

import type { MarqueeRect } from "@/features/terminal/sftp/useFileListMarquee";

export function FileListMarqueeOverlay({ rect }: { rect: MarqueeRect | null }) {
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 border border-primary/80 bg-primary/15"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
