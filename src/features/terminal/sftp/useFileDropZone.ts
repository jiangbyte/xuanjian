/**
 * @file 文件拖放上传区域（Tauri 窗口级拖放；非 Tauri 用 HTML5）
 * @author Charlie
 */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

function pathsFromDataTransfer(dt: DataTransfer): string[] {
  const out: string[] = [];
  if (dt.files?.length) {
    for (const f of Array.from(dt.files)) {
      const p = (f as File & { path?: string }).path;
      if (p) out.push(p);
    }
  }
  return out;
}

/** 在指定容器内监听拖放，回调本地绝对路径列表 */
export function useFileDropZone(
  zoneRef: React.RefObject<HTMLElement | null>,
  onDropPaths: (paths: string[]) => void,
  enabled: boolean,
) {
  const [dragOver, setDragOver] = useState(false);
  const insideRef = useRef(false);
  const depthRef = useRef(0);
  const onDropRef = useRef(onDropPaths);
  onDropRef.current = onDropPaths;

  const setInside = useCallback((inside: boolean) => {
    if (insideRef.current === inside) return;
    insideRef.current = inside;
    setDragOver(inside);
  }, []);

  const handlePaths = useCallback(
    (paths: string[]) => {
      if (!paths.length) return;
      depthRef.current = 0;
      setInside(false);
      onDropRef.current(paths);
    },
    [setInside],
  );

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        const el = zoneRef.current;
        if (!el) return;
        const payload = event.payload;
        if (payload.type === "leave") {
          setInside(false);
          return;
        }
        if (payload.type !== "over" && payload.type !== "drop") return;
        const rect = el.getBoundingClientRect();
        const { x, y } = payload.position;
        const inside =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
        if (payload.type === "over") {
          setInside(inside);
          return;
        }
        if (inside) {
          handlePaths(payload.paths);
        } else {
          setInside(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
      insideRef.current = false;
      setDragOver(false);
    };
  }, [enabled, handlePaths, setInside, zoneRef]);

  const bind =
    enabled && !isTauri()
      ? {
          onDragEnter: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            depthRef.current += 1;
            setInside(true);
          },
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
          },
          onDragLeave: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            depthRef.current = Math.max(0, depthRef.current - 1);
            if (depthRef.current === 0) setInside(false);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            depthRef.current = 0;
            setInside(false);
            const paths = pathsFromDataTransfer(e.dataTransfer);
            if (paths.length) handlePaths(paths);
          },
        }
      : enabled && isTauri()
        ? {
            onDragOver: (e: React.DragEvent) => {
              e.preventDefault();
            },
          }
        : {};

  return { dragOver, bind };
}
