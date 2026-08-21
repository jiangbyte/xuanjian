/**
 * @file 窗口控制按钮
 * @author Charlie
 * @description Tauri 窗口的最小化 / 最大化 / 关闭按钮组。
 * 仅在桌面壳内使用；点击会调用原生窗口 API。
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 标题栏右侧窗口控制：最小化、切换最大化、关闭。
 * @副作用 调用 Tauri `getCurrentWindow()` 的 minimize / toggleMaximize / close。
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    win
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined);
  }, [win]);

  return (
    <div className="flex h-full items-stretch">
      <button
        className="win-btn"
        onClick={() => win.minimize()}
        title="Minimize"
      >
        <Minus size={14} />
      </button>
      <button
        className="win-btn"
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
        title="Maximize"
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        className="win-btn win-btn-close"
        onClick={() => win.close()}
        title="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
