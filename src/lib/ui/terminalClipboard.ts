/**
 * @file xterm 剪贴板快捷键
 * @description 在 xterm 键盘事件层处理复制/粘贴，避免被外层 DOM 拦截。
 */

import type { Terminal } from "@xterm/xterm";
import { clipboardReadText, clipboardWriteText } from "@/lib/ui/clipboard";

export type TerminalClipboardOptions = {
  /** 粘贴文本回调；未提供则仅支持复制 */
  onPaste?: (text: string) => void | Promise<void>;
};

/** 绑定终端复制/粘贴快捷键（Ctrl/Cmd+C 有选区时复制，Ctrl/Cmd+Shift+C/V 等） */
export function attachTerminalClipboard(
  term: Terminal,
  opts?: TerminalClipboardOptions,
): () => void {
  const copySelection = (): boolean => {
    const text = term.getSelection();
    if (!text) return false;
    void clipboardWriteText(text);
    return true;
  };

  const doPaste = () => {
    if (!opts?.onPaste) return;
    void clipboardReadText()
      .then((text) => {
        if (text) return opts.onPaste!(text);
      })
      .catch(() => undefined);
  };

  const onCopy = (ev: ClipboardEvent) => {
    const text = term.getSelection();
    if (!text) return;
    ev.preventDefault();
    ev.clipboardData?.setData("text/plain", text);
    void clipboardWriteText(text);
  };

  const termEl = term.element;
  termEl?.addEventListener("copy", onCopy);

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== "keydown") return true;
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;

    // 有选区时 Ctrl+C 复制（不发送 SIGINT）
    if (mod && !ev.shiftKey && !ev.altKey && key === "c") {
      if (term.hasSelection()) {
        ev.preventDefault();
        copySelection();
        return false;
      }
      return true;
    }

    if (mod && ev.shiftKey && key === "c") {
      ev.preventDefault();
      copySelection();
      return false;
    }

    if (mod && ev.shiftKey && key === "v") {
      if (!opts?.onPaste) return true;
      ev.preventDefault();
      doPaste();
      return false;
    }

    if (mod && !ev.shiftKey && !ev.altKey && ev.key === "Insert") {
      if (copySelection()) {
        ev.preventDefault();
        return false;
      }
    }

    if (ev.shiftKey && !mod && !ev.altKey && ev.key === "Insert") {
      if (!opts?.onPaste) return true;
      ev.preventDefault();
      doPaste();
      return false;
    }

    return true;
  });

  return () => {
    termEl?.removeEventListener("copy", onCopy);
  };
}
