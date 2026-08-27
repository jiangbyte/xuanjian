/**
 * @file 文件列表框选（Windows 资源管理器拖选矩形）
 * @author Charlie
 */

import { useCallback, useRef, useState, type RefObject } from "react";
import type { SftpEntry } from "@/lib/tauri";

export type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const MIN_DRAG_PX = 4;

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

export function useFileListMarquee(opts: {
  containerRef: RefObject<HTMLElement | null>;
  visible: SftpEntry[];
  onSelect: (entries: SftpEntry[], additive: boolean) => void;
  onClear?: () => void;
  enabled?: boolean;
}) {
  const { containerRef, visible, onSelect, onClear, enabled = true } = opts;
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [previewPaths, setPreviewPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const dragRef = useRef<{
    startX: number;
    startY: number;
    additive: boolean;
  } | null>(null);

  const hitTest = useCallback(
    (box: { left: number; top: number; right: number; bottom: number }) => {
      const root = containerRef.current;
      if (!root) return [] as SftpEntry[];
      const rows = root.querySelectorAll<HTMLElement>("[data-file-row]");
      const hits: SftpEntry[] = [];
      for (const el of rows) {
        const path = el.dataset.filePath;
        if (!path) continue;
        const entry = visible.find((e) => e.path === path);
        if (!entry) continue;
        const r = el.getBoundingClientRect();
        if (
          rectsIntersect(box, {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          })
        ) {
          hits.push(entry);
        }
      }
      return hits;
    },
    [containerRef, visible],
  );

  const toContainerRect = useCallback(
    (left: number, top: number, width: number, height: number): MarqueeRect => {
      const root = containerRef.current!;
      const c = root.getBoundingClientRect();
      return {
        left: left - c.left + root.scrollLeft,
        top: top - c.top + root.scrollTop,
        width,
        height,
      };
    },
    [containerRef],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-file-row]")) return;
      if (target.closest("[data-skip-marquee]")) return;

      e.preventDefault();
      const additive = e.ctrlKey || e.metaKey;
      dragRef.current = { startX: e.clientX, startY: e.clientY, additive };

      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = Math.abs(ev.clientX - d.startX);
        const dy = Math.abs(ev.clientY - d.startY);
        if (dx < MIN_DRAG_PX && dy < MIN_DRAG_PX) return;

        const left = Math.min(d.startX, ev.clientX);
        const top = Math.min(d.startY, ev.clientY);
        const width = Math.abs(ev.clientX - d.startX);
        const height = Math.abs(ev.clientY - d.startY);
        setMarquee(toContainerRect(left, top, width, height));
        const hits = hitTest({
          left,
          top,
          right: left + width,
          bottom: top + height,
        });
        setPreviewPaths(new Set(hits.map((h) => h.path)));
      };

      const onUp = (ev: MouseEvent) => {
        const d = dragRef.current;
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        const dx = Math.abs(ev.clientX - (d?.startX ?? ev.clientX));
        const dy = Math.abs(ev.clientY - (d?.startY ?? ev.clientY));

        if (dx < MIN_DRAG_PX && dy < MIN_DRAG_PX) {
          if (!d?.additive) onClear?.();
          setMarquee(null);
          setPreviewPaths(new Set());
          return;
        }

        const left = Math.min(d!.startX, ev.clientX);
        const top = Math.min(d!.startY, ev.clientY);
        const width = Math.abs(ev.clientX - d!.startX);
        const height = Math.abs(ev.clientY - d!.startY);
        const hits = hitTest({
          left,
          top,
          right: left + width,
          bottom: top + height,
        });
        onSelect(hits, d?.additive ?? false);
        setMarquee(null);
        setPreviewPaths(new Set());
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [enabled, hitTest, onClear, onSelect, toContainerRect],
  );

  return { marquee, previewPaths, onMouseDown };
}
