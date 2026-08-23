/**
 * @file Pipeline 运行参数确认
 * @author Charlie
 */

import { Loader2 } from "lucide-react";
import { useState } from "react";
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
import type { PipelineVarField } from "@/lib/pipeline/collectVars";

type Props = {
  open: boolean;
  dryRun: boolean;
  fields: PipelineVarField[];
  onCancel: () => void;
  onConfirm: (vars: Record<string, string>) => void;
};

/** 运行前收集脚本变量，让用户参与参数填写 */
export function PipelineRunVarsDialog({
  open,
  dryRun,
  fields,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      init[f.name] = f.defaultValue ?? "";
    }
    return init;
  });
  const [busy, setBusy] = useState(false);

  const handleConfirm = () => {
    setBusy(true);
    try {
      onConfirm(values);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {dryRun ? t("pipeline.varsTitleDry") : t("pipeline.varsTitle")}
          </DialogTitle>
        </DialogHeader>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pipeline.varsEmpty")}</p>
        ) : (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto py-1">
            {fields.map((f) => (
              <div key={f.name} className="space-y-1.5">
                <Label className="text-xs">
                  {f.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({f.stageName})
                  </span>
                </Label>
                <Input
                  value={values[f.name] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                  }
                  placeholder={f.defaultValue}
                  className="font-mono text-xs"
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("hosts.cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {dryRun ? t("pipeline.dryRun") : t("pipeline.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
