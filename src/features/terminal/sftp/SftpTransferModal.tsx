/**
 * @file SFTP 双栏传输模态框主壳
 * @author Charlie
 * @description 左右传输面板、主机选择与跨栏传输入队的编排入口。
 */

import { ArrowLeft, ArrowLeftRight, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FloatingWindow } from "@/components/FloatingWindow";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { HostPicker } from "@/features/terminal/sftp/HostPicker";
import { hostTitle, joinPath } from "@/features/terminal/sftp/pathUtils";
import { TransferPane } from "@/features/terminal/sftp/TransferPane";
import { enqueueTransferTree } from "@/features/terminal/sftp/transferEnqueue";
import type {
  PaneTab,
  Side,
  SideSnapshot,
} from "@/features/terminal/sftp/types";
import { HostRow, listHosts } from "@/lib/db";
import { dialogs } from "@/lib/dialogs";
import type { SftpEntry } from "@/lib/tauri";
import type { ConflictCtx } from "@/lib/transferConflict";

/** SFTP 双栏文件传输模态框 */
export function SftpTransferModal({
  onClose,
  defaultHostId,
}: {
  onClose: () => void;
  defaultHostId?: number | null;
}) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [leftTabs, setLeftTabs] = useState<PaneTab[]>([]);
  const [rightTabs, setRightTabs] = useState<PaneTab[]>([]);
  const [leftActive, setLeftActive] = useState<string | null>(null);
  const [rightActive, setRightActive] = useState<string | null>(null);
  const [pickerSide, setPickerSide] = useState<Side | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const leftRef = useRef<SideSnapshot | null>(null);
  const rightRef = useRef<SideSnapshot | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    listHosts().then(setHosts).catch(console.error);
  }, []);

  useEffect(() => {
    if (seeded.current) return;
    if (defaultHostId != null && hosts.length === 0) return;
    seeded.current = true;

    const localTab: PaneTab = {
      id: crypto.randomUUID(),
      kind: "local",
      label: t("terminal.localMachine"),
    };
    setLeftTabs([localTab]);
    setLeftActive(localTab.id);

    if (defaultHostId != null) {
      const host = hosts.find((h) => h.id === defaultHostId);
      if (host) {
        const tab: PaneTab = {
          id: crypto.randomUUID(),
          kind: "host",
          hostId: host.id,
          label: hostTitle(host),
        };
        setRightTabs([tab]);
        setRightActive(tab.id);
      }
    }
  }, [hosts, defaultHostId, t]);

  const addTab = (side: Side, tab: PaneTab) => {
    if (side === "left") {
      setLeftTabs((tabs) => [...tabs, tab]);
      setLeftActive(tab.id);
    } else {
      setRightTabs((tabs) => [...tabs, tab]);
      setRightActive(tab.id);
    }
  };

  const closeTab = (side: Side, id: string) => {
    if (side === "left") {
      setLeftTabs((tabs) => {
        const next = tabs.filter((x) => x.id !== id);
        setLeftActive((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
        return next;
      });
    } else {
      setRightTabs((tabs) => {
        const next = tabs.filter((x) => x.id !== id);
        setRightActive((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
        return next;
      });
    }
  };

  const transfer = async (from: Side, forced?: SftpEntry[]) => {
    const src = from === "left" ? leftRef.current : rightRef.current;
    const dst = from === "left" ? rightRef.current : leftRef.current;
    if (!src || !dst) return;
    setBusy(true);
    setMessage(null);
    setOk(false);
    try {
      if (!src.ready || !dst.ready)
        throw new Error(t("terminal.pickHostFirst"));
      const items =
        forced && forced.length
          ? forced
          : src.checked.length
            ? src.checked
            : src.selected
              ? [src.selected]
              : [];
      if (!items.length) throw new Error(t("terminal.pickFileFirst"));

      const conflict: ConflictCtx = { mode: "ask" };
      let queued = 0;
      for (const item of items) {
        const destPath = joinPath(dst.cwd, item.name, dst.remote);
        const result = await enqueueTransferTree(
          src,
          dst,
          item.path,
          destPath,
          item.isDir,
          item.size,
          dialogs,
          t,
          conflict,
        );
        if (result === "abort") {
          setOk(false);
          setMessage(t("transfer.conflictAborted"));
          await dst.reload().catch(() => undefined);
          return;
        }
        queued += 1;
      }
      setOk(true);
      setMessage(`${t("transfer.queued")} (${queued} ${t("terminal.items")})`);
      // Destination listing refreshes when jobs finish; peek now for dirs created.
      await dst.reload().catch(() => undefined);
    } catch (e) {
      setOk(false);
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingWindow
      title={t("terminal.sftpTransfer")}
      onClose={onClose}
      initialWidth={1100}
      initialHeight={680}
      bodyClassName="flex min-h-0 flex-col gap-2 overflow-hidden p-3"
      headerActions={
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title={t("terminal.transferLeft")}
            aria-label={t("terminal.transferLeft")}
            onClick={() => transfer("right")}
          >
            <ArrowLeft size={14} />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title={t("terminal.transferRight")}
            aria-label={t("terminal.transferRight")}
            onClick={() => transfer("left")}
          >
            <ArrowRight size={14} />
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={() => {
              const leftN =
                (leftRef.current?.checked.length || 0) +
                (leftRef.current?.selected ? 1 : 0);
              const rightN =
                (rightRef.current?.checked.length || 0) +
                (rightRef.current?.selected ? 1 : 0);
              if (leftN >= rightN) transfer("left");
              else transfer("right");
            }}
          >
            <ArrowLeftRight size={12} />
            {busy ? t("terminal.transferring") : t("terminal.transfer")}
          </Button>
        </div>
      }
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          id="sftp-left"
          defaultSize={50}
          minSize={30}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        >
          <TransferPane
            side="left"
            tabs={leftTabs}
            activeTabId={leftActive}
            hosts={hosts}
            onActivate={setLeftActive}
            onCloseTab={(id) => closeTab("left", id)}
            onAdd={() => setPickerSide("left")}
            snapshotRef={leftRef}
            onTransferEntry={(entries) => {
              if (!entries.length) return;
              leftRef.current = {
                ...(leftRef.current as SideSnapshot),
                checked: entries,
                selected: entries[0],
              };
              transfer("left", entries).catch(console.error);
            }}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id="sftp-right"
          defaultSize={50}
          minSize={30}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        >
          <TransferPane
            side="right"
            tabs={rightTabs}
            activeTabId={rightActive}
            hosts={hosts}
            onActivate={setRightActive}
            onCloseTab={(id) => closeTab("right", id)}
            onAdd={() => setPickerSide("right")}
            snapshotRef={rightRef}
            onTransferEntry={(entries) => {
              if (!entries.length) return;
              rightRef.current = {
                ...(rightRef.current as SideSnapshot),
                checked: entries,
                selected: entries[0],
              };
              transfer("right", entries).catch(console.error);
            }}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {message && (
        <div
          className={`text-xs ${ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {message}
        </div>
      )}

      {pickerSide && (
        <HostPicker
          side={pickerSide}
          hosts={hosts}
          onClose={() => setPickerSide(null)}
          onPickLocal={() => {
            addTab(pickerSide, {
              id: crypto.randomUUID(),
              kind: "local",
              label: t("terminal.localMachine"),
            });
            setPickerSide(null);
          }}
          onPickHost={(host) => {
            addTab(pickerSide, {
              id: crypto.randomUUID(),
              kind: "host",
              hostId: host.id,
              label: hostTitle(host),
            });
            setPickerSide(null);
          }}
        />
      )}
    </FloatingWindow>
  );
}
