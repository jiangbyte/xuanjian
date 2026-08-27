/**
 * @file 工作空间新建表单
 * @author Charlie
 */

import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceInput } from "@/lib/db/workspaces";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostId: number;
  tabId: string | null;
  defaultName?: string;
  defaultRemoteRoot?: string;
  onSubmit: (input: WorkspaceInput) => Promise<void>;
};

/** 新建工作空间：本地项目目录 ↔ 远程部署根路径 */
export function WorkspaceFormDialog({
  open,
  onOpenChange,
  hostId,
  tabId,
  defaultName = "",
  defaultRemoteRoot = "/var/www/app",
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [localRoot, setLocalRoot] = useState("");
  const [remoteRoot, setRemoteRoot] = useState(defaultRemoteRoot);
  const [exclude, setExclude] = useState("node_modules\n.git\ndist");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setLocalRoot("");
    setRemoteRoot(defaultRemoteRoot);
    setExclude("node_modules\n.git\ndist");
  }, [open, defaultName, defaultRemoteRoot]);

  const pickLocalDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string" && dir) setLocalRoot(dir);
  };

  const onSave = async () => {
    if (!name.trim() || !localRoot.trim()) return;
    setBusy(true);
    try {
      const patterns = exclude
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await onSubmit({
        name: name.trim(),
        local_root: localRoot.trim(),
        host_id: hostId,
        remote_root: remoteRoot.trim() || "/",
        exclude_patterns: patterns.length > 0 ? JSON.stringify(patterns) : null,
        tab_id: tabId,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("terminal.workspaceCreateTitle")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("terminal.workspaceCreateHint")}
          </p>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">{t("terminal.workspaceName")}</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("terminal.workspaceNamePh")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-local">{t("terminal.workspaceLocalRoot")}</Label>
            <div className="flex gap-2">
              <Input
                id="ws-local"
                value={localRoot}
                onChange={(e) => setLocalRoot(e.target.value)}
                placeholder="E:\projects\my-app"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void pickLocalDir()}
                aria-label={t("terminal.workspacePickLocal")}
              >
                <FolderOpen size={16} />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-remote">
              {t("terminal.workspaceRemoteRoot")}
            </Label>
            <Input
              id="ws-remote"
              value={remoteRoot}
              onChange={(e) => setRemoteRoot(e.target.value)}
              placeholder="/var/www/app"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-exclude">{t("terminal.workspaceExclude")}</Label>
            <Textarea
              id="ws-exclude"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              rows={3}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void onSave()}
            disabled={busy || !name.trim() || !localRoot.trim()}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              t("terminal.workspaceCreate")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
