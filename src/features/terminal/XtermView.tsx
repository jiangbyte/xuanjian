/**
 * @file xterm 终端视图
 * @author Charlie
 * @description 单标签页的 xterm.js 封装：会话 IO、尺寸适配、剪贴板与重连。
 * 使用 Tauri 剪贴板 API，避免浏览器 clipboard 权限弹窗。
 * 非激活标签隐藏但仍挂载，切换时 fit + focus。
 */

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContextMenuItem,
  openContextMenu,
  useContextMenu,
} from "@/components/ContextMenu";
import { clipboardReadText, clipboardWriteText } from "@/lib/ui/clipboard";
import { attachTerminalClipboard } from "@/lib/ui/terminalClipboard";
import { dialogs } from "@/lib/ui/dialogs";
import { modKeyLabel } from "@/lib/core/platform";
import { canReconnect, reconnectTermTab } from "@/lib/session/connect";
import { getTranscriptTail } from "@/lib/session/recorder";
import { api, onSessionClosed, onSessionOutput } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings";
import type { TermTab } from "@/stores/ui";

/** 避免 StrictMode / 重挂载对同一次断线重复弹出确认框 */
const promptedClosed = new Set<string>();

/**
 * 单个终端标签的 xterm 视图，绑定会话输出与输入。
 */
export function XtermView({ tab, active }: { tab: TermTab; active: boolean }) {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const termFontSize = useSettingsStore((s) => s.termFontSize);
  const termFontFamily = useSettingsStore((s) => s.termFontFamily);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(tab.sessionId);
  const activeRef = useRef(active);
  const statusRef = useRef(tab.status);
  const wasReconnectRef = useRef(false);
  const hydratedSessionRef = useRef<string | null>(null);
  const tRef = useRef(t);
  const [busy, setBusy] = useState(false);

  activeRef.current = active;
  tRef.current = t;
  sessionRef.current = tab.sessionId;

  const safeFit = (resizePty: boolean) => {
    if (!activeRef.current) return;
    const el = containerRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!el || !term || !fit) return;
    if (el.clientWidth < 24 || el.clientHeight < 24) return;

    const prevCols = term.cols;
    const prevRows = term.rows;
    fit.fit();
    if (!resizePty) return;
    const sid = sessionRef.current;
    if (!sid) return;
    if (term.cols === prevCols && term.rows === prevRows) return;
    if (term.cols < 2 || term.rows < 2) return;
    api.sessionResize(sid, term.cols, term.rows).catch(() => undefined);
  };
  const safeFitRef = useRef(safeFit);
  safeFitRef.current = safeFit;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // —— 创建 xterm 实例与 FitAddon ——
    const term = new Terminal({
      cursorBlink: true,
      fontSize: useSettingsStore.getState().termFontSize,
      fontFamily: useSettingsStore.getState().termFontFamily,
      scrollback: 5000,
      theme: {
        background: "#0f1115",
        foreground: "#e8eaed",
        cursor: "#4ea1ff",
      },
      rightClickSelectsWord: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    requestAnimationFrame(() => safeFitRef.current(true));

    const pasteToSession = async (text: string) => {
      const sid = sessionRef.current;
      if (!sid || !text) return;
      await api.sessionWrite(sid, text);
    };

    const detachClipboard = attachTerminalClipboard(term, {
      onPaste: (text) => pasteToSession(text),
    });

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData?.getData("text") ?? "";
      if (text) {
        pasteToSession(text).catch(console.error);
        return;
      }
      clipboardReadText()
        .then((txt) => pasteToSession(txt))
        .catch(() => undefined);
    };
    el.addEventListener("paste", onPaste);

    // —— 按行缓冲输入，写入命令历史 ——
    const lineBuf = { current: "" };
    const onData = term.onData((data) => {
      const sid = sessionRef.current;
      if (!sid) return;
      api.sessionWrite(sid, data).catch(console.error);
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          const cmd = lineBuf.current.trim();
          lineBuf.current = "";
          if (cmd) {
            import("@/stores/cmdHistory").then(({ useCmdHistory }) => {
              useCmdHistory.getState().push({ cmd, sessionId: sid });
            });
          }
        } else if (ch === "\u007f" || ch === "\b") {
          lineBuf.current = lineBuf.current.slice(0, -1);
        } else if (ch >= " " || ch === "\t") {
          lineBuf.current += ch;
        }
      }
    });

    const ro = new ResizeObserver(() => {
      if (!activeRef.current) return;
      safeFitRef.current(true);
    });
    ro.observe(el);

    // —— 订阅会话输出与关闭 ——
    let unOut: (() => void) | undefined;
    let unClose: (() => void) | undefined;
    onSessionOutput((p) => {
      if (p.sessionId !== sessionRef.current) return;
      // 页面不可见时仍写入以保留缓冲，但不额外触发 fit
      term.write(p.data);
    }).then((u) => {
      unOut = u;
    });
    onSessionClosed((p) => {
      if (p.sessionId === sessionRef.current) {
        term.writeln(
          `\r\n\x1b[90m${tRef.current("terminal.sessionClosedBanner")}\x1b[0m`,
        );
      }
    }).then((u) => {
      unClose = u;
    });

    return () => {
      onData.dispose();
      ro.disconnect();
      el.removeEventListener("paste", onPaste);
      detachClipboard();
      unOut?.();
      unClose?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = termFontSize;
    term.options.fontFamily = termFontFamily;
    requestAnimationFrame(() => safeFitRef.current(true));
  }, [termFontSize, termFontFamily]);

  useEffect(() => {
    const prev = statusRef.current;
    statusRef.current = tab.status;
    const term = termRef.current;
    if (!term) return;
    if (
      tab.status === "connecting" &&
      (prev === "closed" || prev === "error")
    ) {
      wasReconnectRef.current = true;
      term.writeln(`\r\n\x1b[36m${t("terminal.reconnecting")}\x1b[0m`);
    }
    if (tab.status === "open" && wasReconnectRef.current) {
      wasReconnectRef.current = false;
      term.writeln(`\x1b[32m${t("terminal.reconnected")}\x1b[0m\r\n`);
    }
    if (tab.status === "error" && wasReconnectRef.current) {
      wasReconnectRef.current = false;
      term.writeln(`\x1b[31m${t("terminal.reconnectFailed")}\x1b[0m`);
    }
    if (tab.status === "open") {
      promptedClosed.delete(tab.id);
    }
  }, [tab.status, t, tab.id]);

  useEffect(() => {
    if (!tab.sessionId || !active) return;
    requestAnimationFrame(() => safeFitRef.current(true));
  }, [tab.sessionId, active]);

  useEffect(() => {
    if (!tab.sessionId) return;
    if (hydratedSessionRef.current === tab.sessionId) return;
    hydratedSessionRef.current = tab.sessionId;
    let cancelled = false;
    void getTranscriptTail(tab.sessionId, 32_000).then((tail) => {
      if (cancelled || !tail) return;
      const term = termRef.current;
      if (!term) return;
      term.clear();
      term.write(tail);
      requestAnimationFrame(() => safeFitRef.current(false));
    });
    return () => {
      cancelled = true;
    };
  }, [tab.sessionId]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      safeFitRef.current(true);
      termRef.current?.focus();
    });
  }, [active]);

  const doReconnect = useCallback(async () => {
    if (busy || !canReconnect(tab)) return;
    setBusy(true);
    try {
      const cols = termRef.current?.cols;
      const rows = termRef.current?.rows;
      await reconnectTermTab(tab.id, { cols, rows });
    } catch (e) {
      await dialogs.alert(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, tab]);

  const askReconnect = useCallback(async () => {
    if (busy || !canReconnect(tab)) return;
    if (tab.status !== "closed" && tab.status !== "error") return;
    const ok = await dialogs.confirm(t("terminal.reconnectConfirm"), {
      title:
        tab.status === "error"
          ? t("terminal.disconnectedError")
          : t("terminal.disconnected"),
      confirmLabel: t("terminal.reconnect"),
      cancelLabel: t("dialog.cancel"),
    });
    if (!ok) return;
    await doReconnect();
  }, [busy, tab, t, doReconnect]);

  // 本标签断线（或激活时已断线）时弹出一次重连确认
  useEffect(() => {
    if (!active || busy) return;
    if (tab.status !== "closed" && tab.status !== "error") return;
    if (!canReconnect(tab)) return;
    if (promptedClosed.has(tab.id)) return;
    promptedClosed.add(tab.id);
    void askReconnect();
  }, [active, busy, tab, askReconnect]);

  return (
    <div
      className="relative h-full w-full"
      style={{
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 1 : 0,
      }}
      aria-hidden={!active}
    >
      <div
        ref={containerRef}
        className="terminal-surface h-full w-full p-1"
        onContextMenu={(e) => {
          const term = termRef.current;
          const hasSelection = !!(term && term.hasSelection());
          const items: ContextMenuItem[] = [
            {
              id: "copy",
              label: t("context.copy", { mod: modKeyLabel() }),
              disabled: !hasSelection,
              onClick: () => {
                const text = termRef.current?.getSelection() || "";
                if (text) clipboardWriteText(text).catch(() => undefined);
              },
            },
            {
              id: "paste",
              label: t("context.paste", { mod: modKeyLabel() }),
              disabled: !tab.sessionId,
              onClick: async () => {
                const sid = sessionRef.current;
                if (!sid) return;
                try {
                  const text = await clipboardReadText();
                  if (text) await api.sessionWrite(sid, text);
                } catch {
                  /* clipboard denied */
                }
              },
            },
            "sep",
            {
              id: "clear",
              label: t("context.clear"),
              onClick: () => termRef.current?.clear(),
            },
          ];
          if (
            canReconnect(tab) &&
            (tab.status === "closed" || tab.status === "error")
          ) {
            items.push("sep", {
              id: "reconnect",
              label: t("terminal.reconnect"),
              onClick: () => {
                askReconnect().catch(() => undefined);
              },
            });
          }
          openContextMenu(e, openMenu, items);
        }}
      />

      {tab.status === "connecting" && !tab.sessionId && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <div className="rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow">
            {t("terminal.connecting")}
          </div>
        </div>
      )}
    </div>
  );
}
