/**
 * @file 移动端主机列表
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MobileTopBar } from "@/features/mobile/MobileTopBar";
import { listHosts, type HostRow } from "@/lib/db";
import { connectSshHost } from "@/lib/session/connect";
import { useUiStore } from "@/stores/ui";

export function MobileHostsPage() {
  const navigate = useNavigate();
  const addTab = useUiStore((s) => s.addTab);
  const updateTab = useUiStore((s) => s.updateTab);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setHosts(await listHosts());
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const connect = async (host: HostRow) => {
    setBusyId(host.id);
    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      title: host.name,
      kind: "ssh",
      sessionId: null,
      hostId: host.id,
      status: "connecting",
    });
    try {
      const { session } = await connectSshHost(host.id);
      updateTab(tabId, { sessionId: session.id, status: "open" });
      navigate("/m/terminal");
    } catch (e) {
      updateTab(tabId, { status: "error" });
      toast.error(String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MobileTopBar title="主机" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {hosts.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            暂无主机。请在桌面端添加，或稍后在此完善新建流程。
          </p>
        ) : (
          <ul className="space-y-2">
            {hosts.map((h) => (
              <li
                key={h.id}
                className="rounded-xl border border-border bg-card px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{h.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {h.username}@{h.host}:{h.port}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2 w-full"
                  disabled={busyId === h.id}
                  onClick={() => void connect(h)}
                >
                  {busyId === h.id ? "连接中…" : "连接 SSH"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
