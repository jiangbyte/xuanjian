import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    }
  | "sep";

type MenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
} | null;

type ContextMenuApi = {
  open: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
};

const Ctx = createContext<ContextMenuApi | null>(null);

export function useContextMenu() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useContextMenu requires ContextMenuProvider");
  return api;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState>(null);

  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    if (!items.length) return;
    setMenu({ x, y, items });
  }, []);

  const api = useMemo(() => ({ open, close }), [open, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {menu && (
        <ContextMenuView
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={close}
        />
      )}
    </Ctx.Provider>
  );
}

function ContextMenuView({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest(".ctx-menu")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = document.querySelector(".ctx-menu") as HTMLElement | null;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y, items]);

  return createPortal(
    <div
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, i) => {
        if (item === "sep") {
          return <div key={`sep-${i}`} className="ctx-sep" />;
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ctx-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick();
            }}
          >
            {item.icon && <span className="ctx-icon">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
            {item.shortcut && (
              <span className="ctx-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export function openContextMenu(
  e: ReactMouseEvent,
  open: ContextMenuApi["open"],
  items: ContextMenuItem[],
) {
  e.preventDefault();
  e.stopPropagation();
  open(e.clientX, e.clientY, items);
}
