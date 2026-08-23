/**
 * @file Pipeline 运行观测面板
 * @author Charlie
 */

import {
  Bot,
  CheckCircle2,
  Circle,
  Loader2,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PipelineRunRow } from "@/lib/db/pipelines";
import {
  usePipelineRunStore,
  type StageRunStatus,
} from "@/lib/pipeline/runStore";
import type { PipelineRunResult } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

function statusIcon(status: StageRunStatus) {
  switch (status) {
    case "running":
      return <Loader2 size={14} className="animate-spin text-primary" />;
    case "ok":
      return <CheckCircle2 size={14} className="text-emerald-600" />;
    case "error":
      return <XCircle size={14} className="text-destructive" />;
    default:
      return <Circle size={14} className="text-muted-foreground/50" />;
  }
}

function parseRunResult(row: PipelineRunRow | null): PipelineRunResult | null {
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as PipelineRunResult;
  } catch {
    return null;
  }
}

type Props = {
  selectedRun: PipelineRunRow | null;
  selectedStageId: string | null;
  onSelectStage: (id: string) => void;
  onClose?: () => void;
};

/** 实时 / 历史运行日志与阶段进度 */
export function PipelineRunPanel({
  selectedRun,
  selectedStageId,
  onSelectStage,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const live = usePipelineRunStore((s) => s.live);
  const logRef = useRef<HTMLPreElement>(null);
  const historical =
    parseRunResult(selectedRun) ??
    (live?.running ? null : live?.result ?? null);

  const isLive = Boolean(live?.running);
  const stageIds = isLive
    ? live!.stageIds
    : historical?.stages.map((s) => s.stage_id) ?? [];
  const stageNames = isLive
    ? live!.stageNames
    : historical?.stages.map((s) => s.stage_name) ?? [];

  const activeStageId =
    selectedStageId ??
    (isLive && live!.currentIndex >= 0
      ? live!.stageIds[live!.currentIndex]
      : stageIds[0]) ??
    null;

  const logText = (() => {
    if (!activeStageId) return "";
    if (isLive && live) {
      return live.logs[activeStageId] ?? live.liveLog ?? "";
    }
    const stage = historical?.stages.find((s) => s.stage_id === activeStageId);
    return stage?.output ?? stage?.error ?? "";
  })();

  const stagePrompt = (() => {
    if (!activeStageId) return null;
    const stage = historical?.stages.find((s) => s.stage_id === activeStageId);
    return stage?.prompt?.trim() || null;
  })();

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logText]);

  if (!isLive && !selectedRun && !historical) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("pipeline.pickRun")}
      </div>
    );
  }

  const progress = isLive
    ? live!.stageIds.filter(
        (id) => live!.statuses[id] === "ok" || live!.statuses[id] === "error",
      ).length
    : historical?.stages.length ?? 0;
  const total = stageIds.length;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-t border-border bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {isLive ? live!.pipelineName : t("pipeline.runDetail")}
            </span>
            {isLive ? (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {live!.dryRun ? t("pipeline.dryRun") : t("pipeline.running")}
              </Badge>
            ) : null}
            {isLive && live!.source === "agent" ? (
              <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                <Bot size={10} />
                Agent
              </Badge>
            ) : isLive ? (
              <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                <User size={10} />
                {t("pipeline.runByUser")}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-none bg-muted">
              <div
                className={cn(
                  "h-full transition-all",
                  isLive ? "bg-primary" : "bg-emerald-600",
                )}
                style={{ width: `${isLive && live!.running ? pct : 100}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {isLive && live!.running
                ? t("pipeline.progress", {
                    current: Math.min(live!.currentIndex + 1, total),
                    total,
                  })
                : `${total}/${total}`}
            </span>
          </div>
        </div>
        {onClose ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("pipeline.closeRun")}
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-44 shrink-0 overflow-y-auto border-r border-border">
          {stageIds.map((id, i) => {
            const status: StageRunStatus = isLive
              ? (live!.statuses[id] ?? "pending")
              : historical?.stages[i]?.ok
                ? "ok"
                : "error";
            return (
              <button
                key={id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border px-2.5 py-2 text-left text-xs hover:bg-accent",
                  activeStageId === id && "bg-accent",
                )}
                onClick={() => onSelectStage(id)}
              >
                {statusIcon(status)}
                <span className="min-w-0 flex-1 truncate">
                  {i + 1}. {stageNames[i]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {stagePrompt ? (
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t("pipeline.stagePrompt")}: </span>
              {stagePrompt}
            </div>
          ) : null}
          <pre
            ref={logRef}
            className={cn(
              "overflow-y-auto overflow-x-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90",
              stagePrompt ? "h-[calc(100%-2.5rem)]" : "h-full",
            )}
          >
            {logText || (
              <span className="text-muted-foreground">{t("pipeline.noLogYet")}</span>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
