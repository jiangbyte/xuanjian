/**
 * @file 多阶段 Pipeline 控制台
 * @author Charlie
 */

import {
  GitBranch,
  Loader2,
  Play,
  Plus,
  Save,
  TestTube2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConsolePageHeader } from "@/components/ConsolePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PipelineFlowCanvas } from "@/features/pipeline/PipelineFlowCanvas";
import { PipelineRunPanel } from "@/features/pipeline/PipelineRunPanel";
import { PipelineRunVarsDialog } from "@/features/pipeline/PipelineRunVarsDialog";
import {
  StageEditorPanel,
  usePipelineResources,
} from "@/features/pipeline/StageEditorPanel";
import { collectPipelineVars } from "@/lib/pipeline/collectVars";
import {
  createPipeline,
  createPipelineRun,
  deletePipeline,
  finishPipelineRun,
  getPipelineDefinition,
  listPipelineRuns,
  listPipelines,
  updatePipeline,
  type PipelineRow,
  type PipelineRunRow,
} from "@/lib/db/pipelines";
import { runPipeline } from "@/lib/pipeline/runner";
import { usePipelineRunStore } from "@/lib/pipeline/runStore";
import { makeNewStage } from "@/lib/pipeline/stageDefaults";
import type {
  PipelineDefinition,
  PipelineStage,
  PipelineStageType,
} from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

/** Pipeline 可视化配置与运行 */
export function PipelineConsole() {
  const { t } = useTranslation();
  const resources = usePipelineResources();
  const liveRun = usePipelineRunStore((s) => s.live);

  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<PipelineDefinition>({
    version: 1,
    stages: [],
  });
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [runs, setRuns] = useState<PipelineRunRow[]>([]);
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showRunPanel, setShowRunPanel] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runLogStageId, setRunLogStageId] = useState<string | null>(null);

  const [varsOpen, setVarsOpen] = useState(false);
  const [pendingDryRun, setPendingDryRun] = useState(false);
  const [varFields, setVarFields] = useState<
    Awaited<ReturnType<typeof collectPipelineVars>>
  >([]);

  const active = rows.find((r) => r.id === activeId) ?? null;
  const selectedStage =
    definition.stages.find((s) => s.id === selectedStageId) ?? null;
  const selectedStageIndex = definition.stages.findIndex(
    (s) => s.id === selectedStageId,
  );
  const selectedRun =
    runs.find((r) => r.id === selectedRunId) ??
    (liveRun?.runId != null
      ? runs.find((r) => r.id === liveRun.runId) ?? null
      : null);

  const stageStatuses = liveRun?.statuses;

  const reload = useCallback(async () => {
    const [list, r] = await Promise.all([
      listPipelines(),
      activeId != null ? listPipelineRuns(activeId) : listPipelineRuns(),
    ]);
    setRows(list);
    setRuns(r);
  }, [activeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (liveRun?.running) {
      setShowRunPanel(true);
      setSelectedRunId(liveRun.runId);
    }
  }, [liveRun?.running, liveRun?.runId]);

  const loadRow = (row: PipelineRow) => {
    setActiveId(row.id);
    setName(row.name);
    setDescription(row.description ?? "");
    setDefinition(getPipelineDefinition(row));
    setSelectedStageId(null);
    setDirty(false);
    setSelectedRunId(null);
  };

  const onNew = async () => {
    const id = await createPipeline({
      name: t("pipeline.newName"),
      description: "",
      definition: { version: 1, stages: [] },
    });
    await reload();
    const row = await listPipelines().then((l) => l.find((x) => x.id === id));
    if (row) loadRow(row);
    toast.success(t("pipeline.created"));
  };

  const onSave = async () => {
    if (!activeId) return;
    try {
      await updatePipeline(activeId, { name, description, definition });
      setDirty(false);
      await reload();
      toast.success(t("pipeline.saved"));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const onDeletePipeline = async () => {
    if (!activeId) return;
    if (!window.confirm(t("pipeline.deleteConfirm"))) return;
    await deletePipeline(activeId);
    setActiveId(null);
    setDefinition({ version: 1, stages: [] });
    await reload();
  };

  const executeRun = async (
    dryRun: boolean,
    scriptVars: Record<string, string>,
  ) => {
    if (!activeId) return;
    if (dirty) await onSave();
    setRunning(true);
    setShowRunPanel(true);
    setSelectedRunId(null);
    setRunLogStageId(null);
    usePipelineRunStore.getState().clear();

    const runId = await createPipelineRun({
      pipeline_id: activeId,
      dry_run: dryRun,
    });
    setSelectedRunId(runId);

    try {
      const result = await runPipeline(activeId, {
        dryRun,
        runId,
        scriptVars,
        source: "ui",
        streamLogs: true,
      });
      await finishPipelineRun(
        runId,
        result.ok ? "ok" : "error",
        JSON.stringify(result),
      );
      toast.success(
        dryRun
          ? t("pipeline.dryRunDone")
          : result.ok
            ? t("pipeline.runOk")
            : t("pipeline.runFail"),
      );
    } catch (e) {
      await finishPipelineRun(runId, "error", JSON.stringify({ error: String(e) }));
      toast.error(String(e));
    } finally {
      setRunning(false);
      await reload();
      setSelectedRunId(runId);
      setShowRunPanel(true);
    }
  };

  const promptRun = async (dryRun: boolean) => {
    if (!activeId || !definition.stages.length) return;
    const fields = await collectPipelineVars(definition);
    if (fields.length === 0) {
      await executeRun(dryRun, {});
      return;
    }
    setVarFields(fields);
    setPendingDryRun(dryRun);
    setVarsOpen(true);
  };

  const updateStage = (stage: PipelineStage) => {
    setDefinition((d) => ({
      ...d,
      stages: d.stages.map((s) => (s.id === stage.id ? stage : s)),
    }));
    setDirty(true);
  };

  const addStage = (type: PipelineStageType) => {
    const stage = makeNewStage(type, resources);
    setDefinition((d) => ({ ...d, stages: [...d.stages, stage] }));
    setSelectedStageId(stage.id);
    setDirty(true);
  };

  const deleteStage = () => {
    if (!selectedStageId) return;
    setDefinition((d) => ({
      ...d,
      stages: d.stages.filter((s) => s.id !== selectedStageId),
    }));
    setSelectedStageId(null);
    setDirty(true);
  };

  const moveStage = (dir: -1 | 1) => {
    if (!selectedStageId) return;
    const idx = definition.stages.findIndex((s) => s.id === selectedStageId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= definition.stages.length) return;
    const stages = [...definition.stages];
    [stages[idx], stages[next]] = [stages[next], stages[idx]];
    setDefinition((d) => ({ ...d, stages }));
    setDirty(true);
  };

  const activeRuns = useMemo(
    () => runs.filter((r) => r.pipeline_id === activeId),
    [runs, activeId],
  );

  const openRunPanel = (runId?: number | null) => {
    const id = runId ?? selectedRunId ?? activeRuns[0]?.id ?? null;
    if (id != null) setSelectedRunId(id);
    setShowRunPanel(true);
    setRunLogStageId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConsolePageHeader
        icon={GitBranch}
        title={t("pipeline.title")}
        description={t("pipeline.subtitle")}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void onNew()}>
              <Plus size={14} className="mr-1" />
              {t("pipeline.new")}
            </Button>
            {activeId ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!dirty}
                  onClick={() => void onSave()}
                >
                  <Save size={14} className="mr-1" />
                  {t("pipeline.save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => void promptRun(true)}
                >
                  <TestTube2 size={14} className="mr-1" />
                  {t("pipeline.dryRun")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={running || !definition.stages.length}
                  onClick={() => void promptRun(false)}
                >
                  {running ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Play size={14} className="mr-1" />
                  )}
                  {t("pipeline.run")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  onClick={() => void onDeletePipeline()}
                >
                  <Trash2 size={14} />
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-52 shrink-0 flex-col border-r border-border">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              {t("pipeline.list")}
            </div>
            <div className="flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">{t("pipeline.empty")}</p>
              ) : (
                rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={cn(
                      "block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-accent",
                      r.id === activeId && "bg-accent",
                    )}
                    onClick={() => loadRow(r)}
                  >
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {getPipelineDefinition(r).stages.length}{" "}
                      {t("pipeline.stageCount")}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {!active ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
              {t("pipeline.pickOne")}
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col border-r border-border">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                  <div className="min-w-[160px] flex-1 space-y-1">
                    <Input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setDirty(true);
                      }}
                      className="h-8 font-semibold"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStage("exec")}
                  >
                    + exec
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStage("transfer")}
                  >
                    + transfer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStage("sync")}
                  >
                    + sync
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addStage("batch")}
                  >
                    + batch
                  </Button>
                  {dirty ? (
                    <Badge variant="secondary">{t("pipeline.unsaved")}</Badge>
                  ) : null}
                  {(running || liveRun?.running) && (
                    <Badge className="animate-pulse">{t("pipeline.running")}</Badge>
                  )}
                </div>
                <div className="min-h-0 flex-1 p-2">
                  {definition.stages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                      <p>{t("pipeline.noStagesHint")}</p>
                      <p className="text-xs">{t("pipeline.noStagesHint2")}</p>
                    </div>
                  ) : (
                    <PipelineFlowCanvas
                      stages={definition.stages}
                      selectedId={selectedStageId}
                      onSelect={setSelectedStageId}
                      stageStatuses={stageStatuses}
                    />
                  )}
                </div>
                <div className="border-t border-border px-4 py-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("pipeline.description")}
                  </Label>
                  <Textarea
                    rows={2}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                    }}
                    className="mt-1 text-sm"
                  />
                </div>
              </div>

              <aside className="flex w-[340px] shrink-0 flex-col">
                <StageEditorPanel
                  stage={selectedStage}
                  stageIndex={selectedStageIndex}
                  stageCount={definition.stages.length}
                  resources={resources}
                  onChange={updateStage}
                  onDelete={deleteStage}
                  onMoveUp={() => moveStage(-1)}
                  onMoveDown={() => moveStage(1)}
                />
                <div className="flex min-h-[120px] shrink-0 flex-col overflow-hidden border-t border-border">
                  <div className="flex shrink-0 items-center justify-between px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("pipeline.recentRuns")}
                    </span>
                    {showRunPanel ? (
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() => setShowRunPanel(false)}
                      >
                        {t("pipeline.hideRun")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() => openRunPanel()}
                      >
                        {t("pipeline.showRun")}
                      </button>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {activeRuns.length === 0 ? (
                      <p className="px-3 pb-2 text-xs text-muted-foreground">
                        {t("pipeline.noRuns")}
                      </p>
                    ) : (
                      activeRuns.slice(0, 20).map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={cn(
                            "block w-full border-b border-border px-3 py-1.5 text-left text-xs hover:bg-accent",
                            selectedRunId === r.id && "bg-accent",
                          )}
                          onClick={() => openRunPanel(r.id)}
                        >
                          <span
                            className={cn(
                              r.status === "ok"
                                ? "text-emerald-600"
                                : r.status === "running"
                                  ? "text-primary"
                                  : "text-destructive",
                            )}
                          >
                            {r.status}
                          </span>
                          {r.dry_run ? " (dry)" : ""} · {r.started_at}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </aside>
            </>
          )}
        </div>

        {showRunPanel ? (
          <div className="flex h-[min(40vh,320px)] shrink-0 flex-col overflow-hidden border-t border-border">
            <PipelineRunPanel
              selectedRun={selectedRun}
              selectedStageId={runLogStageId}
              onSelectStage={setRunLogStageId}
              onClose={() => {
                if (!running && !liveRun?.running) {
                  setShowRunPanel(false);
                }
              }}
            />
          </div>
        ) : null}
      </div>

      <PipelineRunVarsDialog
        key={varFields.map((f) => f.name).join(",")}
        open={varsOpen}
        dryRun={pendingDryRun}
        fields={varFields}
        onCancel={() => setVarsOpen(false)}
        onConfirm={(vars) => {
          setVarsOpen(false);
          void executeRun(pendingDryRun, vars);
        }}
      />
    </div>
  );
}
