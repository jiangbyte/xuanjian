import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => undefined);
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
