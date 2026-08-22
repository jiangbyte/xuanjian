/**
 * @file 窗口控制按钮
 * @author Charlie
 * @description Tauri 窗口的最小化 / 最大化 / 关闭按钮组。
 * macOS 使用系统红绿灯，本组件不渲染。
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isMacOs } from "@/lib/core/platform";

/**
 * 标题栏右侧窗口控制：最小化、切换最大化、关闭。
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    if (isMacOs()) return;
    win
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined);
  }, [win]);

  if (isMacOs()) return null;

  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => win.minimize()}
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
        title="Maximize"
        aria-label="Maximize"
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="rounded-none text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => win.close()}
        title="Close"
        aria-label="Close"
      >
        <X size={14} />
      </Button>
    </div>
  );
}
