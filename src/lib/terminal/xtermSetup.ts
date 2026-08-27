/**
 * @file xterm 预加载
 * @description 应用启动时拉取 xterm 相关 chunk 并预热隐藏实例，避免首次打开终端白屏。
 */

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

let preloadPromise: Promise<void> | null = null;

async function warmupXtermInstance(): Promise<void> {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;width:80px;height:24px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px";
  document.body.appendChild(host);
  try {
    const term = new Terminal({
      disableStdin: true,
      cols: 8,
      rows: 2,
      theme: { background: "#0f1115", foreground: "#e8eaed" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.write(" ");
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    term.dispose();
  } finally {
    host.remove();
  }
}

/** 预加载 xterm 与终端侧栏模块；可重复调用，共享同一 Promise */
export function preloadXterm(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    await warmupXtermInstance();
    await Promise.all([
      import("@/features/terminal/TerminalLeftPanel"),
      import("@/features/terminal/TerminalRightPanel"),
      import("@/features/terminal/XtermView"),
    ]);
  })().catch((err) => {
    preloadPromise = null;
    console.error("[xterm] preload failed", err);
    throw err;
  });
  return preloadPromise;
}
