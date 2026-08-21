/**
 * @file 批量导出分段选择对话框
 * @author Charlie
 */

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportToFile } from "@/lib/share";

export type ShareSectionKey = "hosts" | "scripts" | "notes" | "dockerProjects";

export type ShareSections = Record<ShareSectionKey, boolean>;

const ALL_OFF: ShareSections = {
  hosts: false,
  scripts: false,
  notes: false,
  dockerProjects: false,
};

/** 分段多选导出；确认后写出 JSON */
export function ShareExportDialog({
  open,
  defaults,
  onOpenChange,
}: {
  open: boolean;
  /** 打开时预勾选的分段 */
  defaults?: Partial<ShareSections>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<ShareSections>({ ...ALL_OFF });
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSections({ ...ALL_OFF, ...defaults });
    setIncludeSecrets(false);
  }, [open]); // 仅在打开时套用 defaults，避免勾选被重置

  const anySelected =
    sections.hosts ||
    sections.scripts ||
    sections.notes ||
    sections.dockerProjects;

  const toggle = (key: ShareSectionKey, checked: boolean) => {
    setSections((prev) => ({ ...prev, [key]: checked }));
    if (key === "hosts" && !checked) setIncludeSecrets(false);
  };

  const runExport = async () => {
    if (!busy && !anySelected) return;
    setBusy(true);
    try {
      const ok = await exportToFile(
        {
          includeHostSecrets: sections.hosts && includeSecrets,
          sections: {
            hosts: sections.hosts,
            scripts: sections.scripts,
            notes: sections.notes,
            dockerProjects: sections.dockerProjects,
          },
        },
        "xuanjian-export.json",
      );
      if (ok) {
        toast.success(t("share.exportDone"));
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const options: { key: ShareSectionKey; label: string }[] = [
    { key: "hosts", label: t("share.sectionHosts") },
    { key: "scripts", label: t("share.sectionScripts") },
    { key: "notes", label: t("share.sectionNotes") },
    { key: "dockerProjects", label: t("share.sectionDocker") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("share.exportTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("share.exportHint")}</p>
        <div className="flex flex-col gap-3 py-1">
          {options.map((opt) => (
            <label
              key={opt.key}
              className="flex cursor-pointer items-center gap-2.5 text-sm"
            >
              <Checkbox
                checked={sections[opt.key]}
                onCheckedChange={(v) => toggle(opt.key, v === true)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
          {sections.hosts ? (
            <label className="mt-1 flex cursor-pointer items-start gap-2.5 border-t border-border pt-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={includeSecrets}
                onCheckedChange={(v) => setIncludeSecrets(v === true)}
              />
              <span>
                <span className="font-medium">{t("share.includeSecrets")}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("share.includeSecretsHint")}
                </span>
              </span>
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("hosts.cancel")}
          </Button>
          <Button
            disabled={busy || !anySelected}
            onClick={() => void runExport()}
          >
            {busy ? <Loader2 className="animate-spin" size={14} /> : null}
            {t("share.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 便于控制台传入稳定的 defaults 引用 */
export function shareDefaults(
  ...keys: ShareSectionKey[]
): Partial<ShareSections> {
  const out: Partial<ShareSections> = {};
  for (const k of keys) out[k] = true;
  return out;
}

export const DEFAULT_EXPORT_HOSTS = shareDefaults("hosts");
export const DEFAULT_EXPORT_SCRIPTS = shareDefaults("scripts");
export const DEFAULT_EXPORT_NOTES = shareDefaults("notes");
export const DEFAULT_EXPORT_DOCKER = shareDefaults("dockerProjects");
export const DEFAULT_EXPORT_ALL: ShareSections = {
  hosts: true,
  scripts: true,
  notes: true,
  dockerProjects: true,
};
