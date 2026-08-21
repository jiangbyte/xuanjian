import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Home,
  Plus,
  Settings,
  PanelLeft,
  PanelRight,
  ArrowDownUp,
} from "lucide-react";
import { WindowControls } from "./WindowControls";
import { useUiStore } from "../stores/ui";
import { useTransferStore } from "../stores/transfer";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  openContextMenu,
  useContextMenu,
} from "./ContextMenu";
import {
  canReconnect,
  reconnectTermTab,
} from "../lib/sessionConnect";
import { useDialog } from "./Dialog";
import { TransferPanel } from "../features/terminal/TransferPanel";

function TransferPopover({
  anchor,
  onClose,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = 440;
      const margin = 8;
      const left = Math.max(
        margin,
        Math.min(r.right - width, window.innerWidth - width - margin),
      );
      setPos({ top: r.bottom + 6, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    // Defer so the opening click doesn't immediately close.
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="transfer-popover"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="File transfer"
    >
      <TransferPanel />
    </div>,
    document.body,
  );
}

export function TitleBar() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const dialog = useDialog();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const leftCollapsed = useUiStore((s) => s.leftCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightCollapsed);
  const transferOpen = useUiStore((s) => s.transferOpen);
  const toggleLeft = useUiStore((s) => s.toggleLeft);
  const toggleRight = useUiStore((s) => s.toggleRight);
  const toggleTransfer = useUiStore((s) => s.toggleTransfer);
  const setTransferOpen = useUiStore((s) => s.setTransferOpen);
  const transferBtnRef = useRef<HTMLButtonElement>(null);
  const activeTransfers = useTransferStore(
    (s) =>
      s.jobs.filter(
        (j) =>
          j.status === "running" ||
          j.status === "queued" ||
          j.status === "paused",
      ).length,
  );
  const navigate = useNavigate();
  const location = useLocation();
  const onTerminal = location.pathname === "/terminal";

  return (
    <header
      className="flex h-10 shrink-0 items-center border-b border-[var(--border)] bg-[var(--titlebar)]"
      data-tauri-drag-region
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1 px-2"
        data-tauri-drag-region
      >
        <button
          className="icon-btn"
          onClick={() => navigate("/")}
          title={t("brand")}
        >
          <Home size={14} />
        </button>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                navigate("/terminal");
              }}
              onContextMenu={(e) =>
                openContextMenu(e, openMenu, [
                  ...(canReconnect(tab)
                    ? [
                        {
                          id: "reconnect",
                          label: t("terminal.reconnect"),
                          onClick: async () => {
                            const ok = await dialog.confirm(
                              t("terminal.reconnectConfirm"),
                              {
                                title: t("terminal.disconnected"),
                                confirmLabel: t("terminal.reconnect"),
                                cancelLabel: t("dialog.cancel"),
                              },
                            );
                            if (!ok) return;
                            try {
                              await reconnectTermTab(tab.id);
                            } catch (err) {
                              await dialog.alert(String(err));
                            }
                          },
                        },
                        "sep" as const,
                      ]
                    : []),
                  {
                    id: "close",
                    label: t("context.closeTab"),
                    onClick: () => {
                      closeTab(tab.id);
                      if (tabs.length <= 1) navigate("/");
                    },
                  },
                  {
                    id: "closeOthers",
                    label: t("context.closeOtherTabs"),
                    disabled: tabs.length <= 1,
                    onClick: () => {
                      tabs
                        .filter((x) => x.id !== tab.id)
                        .forEach((x) => closeTab(x.id));
                      setActiveTab(tab.id);
                      navigate("/terminal");
                    },
                  },
                ])
              }
              className={`tab-chip group ${activeTabId === tab.id && onTerminal ? "active" : ""}`}
            >
              <span
                className={`status-dot ${
                  tab.status === "open"
                    ? "is-open"
                    : tab.status === "connecting"
                      ? "is-connecting"
                      : tab.status === "closed"
                        ? "is-closed"
                        : tab.status === "error"
                          ? "is-error"
                          : ""
                }`}
              />
              <span className="truncate">{tab.title}</span>
              <span
                className="icon-btn icon-btn-sm opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                  if (tabs.length <= 1) navigate("/");
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            className="icon-btn"
            onClick={() => setSwitcherOpen(true)}
            title="New session (Ctrl+J)"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="flex h-full items-center gap-0.5 pr-0">
        {onTerminal && (
          <>
            <button
              className={`icon-btn ${leftCollapsed ? "" : "is-active"}`}
              onClick={toggleLeft}
              title={leftCollapsed ? t("terminal.expand") : t("terminal.collapse")}
            >
              <PanelLeft size={14} />
            </button>
            <button
              className={`icon-btn ${rightCollapsed ? "" : "is-active"}`}
              onClick={toggleRight}
              title={rightCollapsed ? t("terminal.expand") : t("terminal.collapse")}
            >
              <PanelRight size={14} />
            </button>
          </>
        )}
        <button
          ref={transferBtnRef}
          className={`icon-btn relative ${transferOpen ? "is-active" : ""}`}
          onClick={() => toggleTransfer()}
          title={t("transfer.title")}
        >
          <ArrowDownUp size={14} />
          {activeTransfers > 0 ? (
            <span className="transfer-title-badge">{activeTransfers}</span>
          ) : null}
        </button>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title={t("nav.settings")}
        >
          <Settings size={14} />
        </button>
        <WindowControls />
      </div>
      {transferOpen ? (
        <TransferPopover
          anchor={transferBtnRef.current}
          onClose={() => setTransferOpen(false)}
        />
      ) : null}
    </header>
  );
}
