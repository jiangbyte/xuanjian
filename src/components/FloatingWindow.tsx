/**
 * @file 可拖拽浮动窗口
 * @author Charlie
 * @description 遮罩层上的可移动 / 八向缩放浮动面板。
 * 用于表单弹层等；点击遮罩关闭，标题栏拖动，边缘手柄缩放；可选全屏。
 * 通过 Portal 挂到 body，避免被终端侧栏 / Resizable / xterm 画布层级盖住。
 */

import { Maximize2, Minimize2, X } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 420;
const MIN_H = 320;
const DEFAULT_W = 560;
const DEFAULT_H = 480;

function clampRect(rect: Rect): Rect {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  const w = Math.min(Math.max(rect.w, MIN_W), maxW - 24);
  const h = Math.min(Math.max(rect.h, MIN_H), maxH - 24);
  const x = Math.min(Math.max(rect.x, 8), maxW - w - 8);
  const y = Math.min(Math.max(rect.y, 8), maxH - h - 8);
  return { x, y, w, h };
}

function centeredRect(w = DEFAULT_W, h = DEFAULT_H): Rect {
  const width = Math.min(w, window.innerWidth - 48);
  const height = Math.min(h, window.innerHeight - 48);
  return clampRect({
    x: (window.innerWidth - width) / 2,
    y: (window.innerHeight - height) / 2,
    w: width,
    h: height,
  });
}

function fullscreenRect(): Rect {
  return {
    x: 8,
    y: 8,
    w: Math.max(MIN_W, window.innerWidth - 16),
    h: Math.max(MIN_H, window.innerHeight - 16),
  };
}

const HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: "n", className: "floating-resize-n" },
  { dir: "s", className: "floating-resize-s" },
  { dir: "e", className: "floating-resize-e" },
  { dir: "w", className: "floating-resize-w" },
  { dir: "ne", className: "floating-resize-ne" },
  { dir: "nw", className: "floating-resize-nw" },
  { dir: "se", className: "floating-resize-se" },
  { dir: "sw", className: "floating-resize-sw" },
];

/**
 * 浮动窗口：居中打开，支持拖动与缩放。
 * @param title 标题栏文案
 * @param onClose 关闭回调（遮罩或关闭按钮）
 * @param children 主体内容
 * @param initialWidth / initialHeight 初始尺寸
 * @param headerActions 标题栏额外操作区
 * @param allowFullscreen 显示全屏切换按钮
 */
export function FloatingWindow({
  title,
  onClose,
  children,
  initialWidth,
  initialHeight,
  headerActions,
  bodyClassName = "p-5",
  allowFullscreen = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialWidth?: number;
  initialHeight?: number;
  headerActions?: ReactNode;
  bodyClassName?: string;
  allowFullscreen?: boolean;
}) {
  const [rect, setRect] = useState<Rect>(() =>
    centeredRect(initialWidth ?? DEFAULT_W, initialHeight ?? DEFAULT_H),
  );
  const [fullscreen, setFullscreen] = useState(false);
  const restoredRef = useRef<Rect | null>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    dir?: ResizeDir;
    startX: number;
    startY: number;
    origin: Rect;
  } | null>(null);

  useEffect(() => {
    const onResize = () => {
      setRect((r) => (fullscreen ? fullscreenRect() : clampRect(r)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fullscreen]);

  const toggleFullscreen = () => {
    setFullscreen((prev) => {
      if (prev) {
        const restored = restoredRef.current;
        restoredRef.current = null;
        if (restored) setRect(clampRect(restored));
        return false;
      }
      restoredRef.current = rect;
      setRect(fullscreenRect());
      return true;
    });
  };

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const o = drag.origin;

    if (drag.mode === "move") {
      setRect(clampRect({ ...o, x: o.x + dx, y: o.y + dy }));
      return;
    }

    const dir = drag.dir!;
    let { x, y, w, h } = o;
    if (dir.includes("e")) w = o.w + dx;
    if (dir.includes("s")) h = o.h + dy;
    if (dir.includes("w")) {
      w = o.w - dx;
      x = o.x + dx;
    }
    if (dir.includes("n")) {
      h = o.h - dy;
      y = o.y + dy;
    }

    // 触达最小尺寸时保持对边锚定
    if (w < MIN_W && dir.includes("w")) x = o.x + o.w - MIN_W;
    if (h < MIN_H && dir.includes("n")) y = o.y + o.h - MIN_H;

    setRect(clampRect({ x, y, w, h }));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startMove = (e: ReactPointerEvent) => {
    if (fullscreen) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      origin: rect,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  const startResize = (dir: ResizeDir) => (e: ReactPointerEvent) => {
    if (fullscreen) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: "resize",
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origin: rect,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  return createPortal(
    <div
      className="fixed inset-0 isolate z-[70] bg-black/40"
      onClick={onClose}
    >
      <div
        className="floating-window absolute flex flex-col overflow-hidden"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* —— 标题栏（拖动） —— */}
        <div
          className={cn(
            "floating-window-title flex shrink-0 items-center justify-between gap-2 overflow-hidden px-4 py-2",
            fullscreen ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          )}
          onPointerDown={startMove}
        >
          <h2 className="select-none text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1">
            {headerActions}
            {allowFullscreen ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleFullscreen}
                title={fullscreen ? "退出全屏" : "全屏"}
                aria-label={fullscreen ? "退出全屏" : "全屏"}
                aria-pressed={fullscreen}
              >
                {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "floating-window-body min-h-0 flex-1 overflow-auto overscroll-contain",
            bodyClassName,
          )}
        >
          {children}
        </div>

        {/* —— 八向缩放手柄 —— */}
        {!fullscreen
          ? HANDLES.map(({ dir, className }) => (
              <div
                key={dir}
                className={`floating-resize ${className}`}
                onPointerDown={startResize(dir)}
              />
            ))
          : null}
      </div>
    </div>,
    document.body,
  );
}
