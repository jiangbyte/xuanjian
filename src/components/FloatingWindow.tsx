import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { X } from "lucide-react";

type ResizeDir =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

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

export function FloatingWindow({
  title,
  onClose,
  children,
  initialWidth,
  initialHeight,
  headerActions,
  bodyClassName = "p-5",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialWidth?: number;
  initialHeight?: number;
  headerActions?: ReactNode;
  bodyClassName?: string;
}) {
  const [rect, setRect] = useState<Rect>(() =>
    centeredRect(initialWidth ?? DEFAULT_W, initialHeight ?? DEFAULT_H),
  );
  const dragRef = useRef<{
    mode: "move" | "resize";
    dir?: ResizeDir;
    startX: number;
    startY: number;
    origin: Rect;
  } | null>(null);

  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

    // Keep opposite edge anchored when hitting min size
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

  return (
    <div className="overlay z-[70]" onClick={onClose}>
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
        <div
          className="floating-window-title flex shrink-0 cursor-grab items-center justify-between px-4 py-2.5 active:cursor-grabbing"
          onPointerDown={startMove}
        >
          <h2 className="select-none text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1">
            {headerActions}
            <button className="icon-btn" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div
          className={`floating-window-body min-h-0 flex-1 overflow-auto overscroll-contain ${bodyClassName}`}
        >
          {children}
        </div>

        {HANDLES.map(({ dir, className }) => (
          <div
            key={dir}
            className={`floating-resize ${className}`}
            onPointerDown={startResize(dir)}
          />
        ))}
      </div>
    </div>
  );
}
