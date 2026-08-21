import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTranslation } from "react-i18next";
import { api, onSessionClosed, onSessionOutput } from "../../lib/tauri";
import { clipboardReadText, clipboardWriteText } from "../../lib/clipboard";
import {
  openContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "../../components/ContextMenu";
import {
  canReconnect,
  reconnectTermTab,
} from "../../lib/sessionConnect";
import type { TermTab } from "../../stores/ui";
import { useDialog } from "../../components/Dialog";
import { useSettingsStore } from "../../stores/settings";

/** Avoid StrictMode / remount double-prompts for the same disconnect. */
const promptedClosed = new Set<string>();

export function XtermView({
  tab,
  active,
}: {
  tab: TermTab;
  active: boolean;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: useSettingsStore.getState().termFontSize,
      fontFamily: useSettingsStore.getState().termFontFamily,
      scrollback: 10000,
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
    requestAnimationFrame(() => safeFit(true));

    const pasteToSession = async (text: string) => {
      const sid = sessionRef.current;
      if (!sid || !text) return;
      await api.sessionWrite(sid, text);
    };

    // Prefer paste event / Tauri clipboard — never navigator.clipboard (browser prompt).
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData?.getData("text") ?? "";
      if (text) {
        pasteToSession(text).catch(console.error);
        return;
      }
      clipboardReadText()
        .then((t) => pasteToSession(t))
        .catch(() => undefined);
    };
    el.addEventListener("paste", onPaste);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey || e.altKey) return;

      if (key === "c") {
        const text = term.getSelection();
        if (!text) return;
        e.preventDefault();
        e.stopPropagation();
        clipboardWriteText(text).catch(() => undefined);
        return;
      }
      if (key === "v") {
        e.preventDefault();
        e.stopPropagation();
        clipboardReadText()
          .then((t) => pasteToSession(t))
          .catch(() => undefined);
      }
    };
    // Capture phase so we win over leftover browser / plugin handlers.
    el.addEventListener("keydown", onKeyDown, true);

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      const key = ev.key.toLowerCase();
      const mod = ev.ctrlKey || ev.metaKey;

      // Already handled in capture listener; keep xterm from emitting to PTY.
      if (mod && ev.shiftKey && (key === "c" || key === "v")) {
        return false;
      }
      if (mod && !ev.shiftKey && !ev.altKey && ev.key === "Insert") {
        const text = term.getSelection();
        if (text) {
          ev.preventDefault();
          clipboardWriteText(text).catch(() => undefined);
          return false;
        }
      }
      if (ev.shiftKey && !mod && ev.key === "Insert") {
        ev.preventDefault();
        clipboardReadText()
          .then((t) => pasteToSession(t))
          .catch(() => undefined);
        return false;
      }
      return true;
    });

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
            import("../../stores/cmdHistory").then(({ useCmdHistory }) => {
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
      safeFit(true);
    });
    ro.observe(el);

    let unOut: (() => void) | undefined;
    let unClose: (() => void) | undefined;
    onSessionOutput((p) => {
      if (p.sessionId === sessionRef.current) term.write(p.data);
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
      el.removeEventListener("keydown", onKeyDown, true);
      unOut?.();
      unClose?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = termFontSize;
    term.options.fontFamily = termFontFamily;
    requestAnimationFrame(() => safeFit(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termFontSize, termFontFamily]);

  useEffect(() => {
    const prev = statusRef.current;
    statusRef.current = tab.status;
    const term = termRef.current;
    if (!term) return;
    if (tab.status === "connecting" && (prev === "closed" || prev === "error")) {
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
    requestAnimationFrame(() => safeFit(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId, active]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      safeFit(true);
      termRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const doReconnect = async () => {
    if (busy || !canReconnect(tab)) return;
    setBusy(true);
    try {
      const cols = termRef.current?.cols;
      const rows = termRef.current?.rows;
      await reconnectTermTab(tab.id, { cols, rows });
    } catch (e) {
      await dialog.alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const askReconnect = async () => {
    if (busy || !canReconnect(tab)) return;
    if (tab.status !== "closed" && tab.status !== "error") return;
    const ok = await dialog.confirm(t("terminal.reconnectConfirm"), {
      title:
        tab.status === "error"
          ? t("terminal.disconnectedError")
          : t("terminal.disconnected"),
      confirmLabel: t("terminal.reconnect"),
      cancelLabel: t("dialog.cancel"),
    });
    if (!ok) return;
    await doReconnect();
  };

  // One confirm/cancel dialog when this tab disconnects (or becomes active while disconnected).
  useEffect(() => {
    if (!active || busy) return;
    if (tab.status !== "closed" && tab.status !== "error") return;
    if (!canReconnect(tab)) return;
    if (promptedClosed.has(tab.id)) return;
    promptedClosed.add(tab.id);
    void askReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tab.status, tab.id]);

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
        className="h-full w-full p-1"
        onContextMenu={(e) => {
          const term = termRef.current;
          const hasSelection = !!(term && term.hasSelection());
          const items: ContextMenuItem[] = [
            {
              id: "copy",
              label: t("context.copy"),
              disabled: !hasSelection,
              onClick: () => {
                const text = termRef.current?.getSelection() || "";
                if (text) clipboardWriteText(text).catch(() => undefined);
              },
            },
            {
              id: "paste",
              label: t("context.paste"),
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
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs muted shadow">
            {t("terminal.connecting")}
          </div>
        </div>
      )}
    </div>
  );
}
