/**
 * @file 右键上下文菜单（shadcn DropdownMenu）
 * @author Charlie
 * @description 全局 open(x,y,items)；定位触发点 + DropdownMenu。
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** 菜单项：普通操作或分隔线 `"sep"` */
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

/** 读取右键菜单 API */
export function useContextMenu() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useContextMenu requires ContextMenuProvider");
  return api;
}

/** Provider：Portal 由 DropdownMenu 处理 */
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
        <DropdownMenu
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-hidden
              className="fixed size-px opacity-0"
              style={{ left: menu.x, top: menu.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={0}
            className="min-w-40"
          >
            {menu.items.map((item, i) => {
              if (item === "sep") {
                return <DropdownMenuSeparator key={`sep-${i}`} />;
              }
              return (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  variant={item.danger ? "destructive" : "default"}
                  onSelect={() => {
                    close();
                    item.onClick();
                  }}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {item.shortcut}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Ctx.Provider>
  );
}

/** 在 React 右键事件上打开菜单 */
export function openContextMenu(
  e: ReactMouseEvent,
  open: ContextMenuApi["open"],
  items: ContextMenuItem[],
) {
  e.preventDefault();
  e.stopPropagation();
  open(e.clientX, e.clientY, items);
}
