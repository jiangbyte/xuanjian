/**
 * @file Pipeline 阶段编辑器
 * @author Charlie
 */

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listGroups, listHosts, listScripts, listWorkspaces } from "@/lib/db";
import type {
  PipelineEndpoint,
  PipelineStage,
  PipelineStageType,
} from "@/lib/pipeline/types";
import type { PipelineResourceContext } from "@/lib/pipeline/stageDefaults";
import { makeNewStage } from "@/lib/pipeline/stageDefaults";
import { api } from "@/lib/tauri";

type Props = {
  stage: PipelineStage | null;
  stageIndex: number;
  stageCount: number;
  resources: PipelineResourceContext;
  onChange: (stage: PipelineStage) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

function EndpointFields({
  label,
  value,
  onChange,
  hosts,
  wslDistros,
}: {
  label: string;
  value: PipelineEndpoint;
  onChange: (ep: PipelineEndpoint) => void;
  hosts: Awaited<ReturnType<typeof listHosts>>;
  wslDistros: string[];
}) {
  const { t } = useTranslation();
  const kind = value.kind;
  return (
    <div className="space-y-2 rounded-none border border-border p-3">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={kind}
        onValueChange={(k) => {
          if (k === "local") onChange({ kind: "local" });
          else if (k === "wsl") {
            const d = wslDistros[0];
            onChange(
              d
                ? { kind: "wsl", wsl_distro: d, shell_id: `local:wsl:${d}` }
                : { kind: "wsl", wsl_distro: "" },
            );
          } else if (k === "ssh" && hosts[0])
            onChange({ kind: "ssh", host_id: hosts[0].id });
        }}
      >
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">{t("pipeline.endpointLocal")}</SelectItem>
          <SelectItem value="wsl">{t("pipeline.endpointWsl")}</SelectItem>
          <SelectItem value="ssh" disabled={hosts.length === 0}>
            {t("pipeline.endpointSsh")}
          </SelectItem>
        </SelectContent>
      </Select>
      {kind === "wsl" ? (
        wslDistros.length > 0 ? (
          <Select
            value={
              value.kind === "wsl"
                ? value.shell_id?.replace(/^local:wsl:/, "") ||
                  value.wsl_distro ||
                  wslDistros[0]
                : wslDistros[0]
            }
            onValueChange={(d) =>
              onChange({
                kind: "wsl",
                wsl_distro: d,
                shell_id: `local:wsl:${d}`,
              })
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {wslDistros.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("pipeline.noWsl")}
          </p>
        )
      ) : null}
      {kind === "ssh" ? (
        <Select
          value={value.kind === "ssh" ? String(value.host_id) : undefined}
          onValueChange={(v) => onChange({ kind: "ssh", host_id: Number(v) })}
        >
          <SelectTrigger className="h-8">
            <SelectValue placeholder={t("pipeline.pickHost")} />
          </SelectTrigger>
          <SelectContent>
            {hosts.map((h) => (
              <SelectItem key={h.id} value={String(h.id)}>
                {h.name} ({h.host})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

/** 单阶段属性编辑 */
export function StageEditorPanel({
  stage,
  stageIndex,
  stageCount,
  resources,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Props) {
  const { t } = useTranslation();
  const { hosts, scripts, workspaces, groups, wslDistros } = resources;

  if (!stage) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("pipeline.selectStage")}
      </div>
    );
  }

  const patch = (p: Partial<PipelineStage>) =>
    onChange({ ...stage, ...p } as PipelineStage);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{t("pipeline.stageEditor")}</h2>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={stageIndex <= 0}
            onClick={onMoveUp}
            title={t("pipeline.moveUp")}
          >
            <ArrowUp size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={stageIndex >= stageCount - 1}
            onClick={onMoveDown}
            title={t("pipeline.moveDown")}
          >
            <ArrowDown size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-destructive"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <Label>{t("pipeline.stageName")}</Label>
          <Input
            value={stage.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("pipeline.stagePrompt")}</Label>
          <Textarea
            rows={3}
            value={stage.prompt ?? ""}
            onChange={(e) => patch({ prompt: e.target.value })}
            placeholder={t("pipeline.stagePromptHint")}
            className="text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            {t("pipeline.stagePromptDesc")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("pipeline.stageType")}</Label>
          <Select
            value={stage.type}
            onValueChange={(v) => {
              const type = v as PipelineStageType;
              onChange({
                ...makeNewStage(type, resources),
                id: stage.id,
                name: stage.name,
                prompt: stage.prompt,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exec">{t("pipeline.typeExec")}</SelectItem>
              <SelectItem value="transfer">{t("pipeline.typeTransfer")}</SelectItem>
              <SelectItem value="sync">{t("pipeline.typeSync")}</SelectItem>
              <SelectItem value="batch">{t("pipeline.typeBatch")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("pipeline.onFailure")}</Label>
          <Select
            value={stage.on_failure ?? "stop"}
            onValueChange={(v) =>
              patch({ on_failure: v as "stop" | "continue" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stop">{t("pipeline.onFailureStop")}</SelectItem>
              <SelectItem value="continue">
                {t("pipeline.onFailureContinue")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {stage.type === "exec" ? (
          <>
            <EndpointFields
              label={t("pipeline.execOn")}
              value={stage.endpoint}
              onChange={(endpoint) => patch({ endpoint })}
              hosts={hosts}
              wslDistros={wslDistros}
            />
            <div className="space-y-1.5">
              <Label>{t("pipeline.command")}</Label>
              <Textarea
                rows={4}
                value={stage.command ?? ""}
                onChange={(e) => patch({ command: e.target.value })}
                className="font-mono text-xs"
                placeholder={t("pipeline.commandHint")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("pipeline.scriptId")}</Label>
              <Select
                value={
                  stage.script_id != null ? String(stage.script_id) : "__none__"
                }
                onValueChange={(v) =>
                  patch({
                    script_id: v === "__none__" ? undefined : Number(v),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("pipeline.noScript")}</SelectItem>
                  {scripts.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}

        {stage.type === "transfer" ? (
          <>
            <EndpointFields
              label={t("pipeline.source")}
              value={stage.source}
              onChange={(source) => patch({ source })}
              hosts={hosts}
              wslDistros={wslDistros}
            />
            <EndpointFields
              label={t("pipeline.target")}
              value={stage.target}
              onChange={(target) => patch({ target })}
              hosts={hosts}
              wslDistros={wslDistros}
            />
            <div className="space-y-1.5">
              <Label>{t("pipeline.fromPath")}</Label>
              <Input
                value={stage.from_path}
                onChange={(e) => patch({ from_path: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("pipeline.toPath")}</Label>
              <Input
                value={stage.to_path}
                onChange={(e) => patch({ to_path: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="preferScp"
                checked={stage.prefer_scp !== false}
                onCheckedChange={(v) => patch({ prefer_scp: v === true })}
              />
              <Label htmlFor="preferScp" className="text-xs font-normal">
                {t("pipeline.preferScp")}
              </Label>
            </div>
          </>
        ) : null}

        {stage.type === "sync" ? (
          <>
            <div className="space-y-1.5">
              <Label>{t("pipeline.workspace")}</Label>
              <Select
                value={
                  workspaces.some((w) => w.id === stage.workspace_id)
                    ? String(stage.workspace_id)
                    : undefined
                }
                onValueChange={(v) => patch({ workspace_id: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("pipeline.noWorkspace")} />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="syncDry"
                checked={Boolean(stage.dry_run)}
                onCheckedChange={(v) => patch({ dry_run: v === true })}
              />
              <Label htmlFor="syncDry" className="text-xs font-normal">
                {t("pipeline.syncDryRun")}
              </Label>
            </div>
          </>
        ) : null}

        {stage.type === "batch" ? (
          <>
            <div className="space-y-1.5">
              <Label>{t("pipeline.scriptId")}</Label>
              <Select
                value={String(stage.script_id)}
                onValueChange={(v) => patch({ script_id: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scripts.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("pipeline.hostGroup")}</Label>
              <Select
                value={
                  stage.host_group_id != null
                    ? String(stage.host_group_id)
                    : "__none__"
                }
                onValueChange={(v) =>
                  patch({
                    host_group_id: v === "__none__" ? undefined : Number(v),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("pipeline.noGroup")}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("pipeline.hostIds")}</Label>
              <Input
                placeholder="1,2,3"
                value={(stage.host_ids ?? []).join(",")}
                onChange={(e) => {
                  const ids = e.target.value
                    .split(/[,\s]+/)
                    .map((x) => Number(x.trim()))
                    .filter((n) => Number.isFinite(n) && n > 0);
                  patch({ host_ids: ids.length ? ids : undefined });
                }}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 加载 Pipeline 编辑所需资源 */
export function usePipelineResources(): PipelineResourceContext {
  const [ctx, setCtx] = useState<PipelineResourceContext>({
    hosts: [],
    workspaces: [],
    scripts: [],
    groups: [],
    wslDistros: [],
  });

  useEffect(() => {
    void (async () => {
      const [hosts, workspaces, scripts, groups, shells] = await Promise.all([
        listHosts(),
        listWorkspaces(),
        listScripts(),
        listGroups(),
        api.listLocalShells(),
      ]);
      const wslDistros = shells
        .filter((s) => s.id.startsWith("local:wsl:"))
        .map((s) => s.id.replace(/^local:wsl:/, ""));
      setCtx({ hosts, workspaces, scripts, groups, wslDistros });
    })();
  }, []);

  return ctx;
}
