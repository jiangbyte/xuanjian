/**
 * @file Pipeline 运行态共享存储
 * @author Charlie
 * @description UI 与 Agent 共用，用于实时展示流水线执行进度与日志。
 */

import { create } from "zustand";
import type { PipelineRunResult, PipelineStageResult } from "@/lib/pipeline/types";

export type StageRunStatus = "pending" | "running" | "ok" | "error" | "skipped";

export type PipelineLiveRun = {
  runId: number | null;
  pipelineId: number;
  pipelineName: string;
  dryRun: boolean;
  stageIds: string[];
  stageNames: string[];
  currentIndex: number;
  statuses: Record<string, StageRunStatus>;
  logs: Record<string, string>;
  liveLog: string;
  running: boolean;
  startedAt: string;
  result: PipelineRunResult | null;
  source: "ui" | "agent";
};

type PipelineRunStore = {
  live: PipelineLiveRun | null;
  startRun: (input: {
    runId: number | null;
    pipelineId: number;
    pipelineName: string;
    dryRun: boolean;
    stageIds: string[];
    stageNames: string[];
    source?: "ui" | "agent";
  }) => void;
  stageStart: (index: number) => void;
  appendLog: (stageId: string, chunk: string) => void;
  stageEnd: (index: number, result: PipelineStageResult) => void;
  finishRun: (result: PipelineRunResult) => void;
  clear: () => void;
};

export const usePipelineRunStore = create<PipelineRunStore>((set, get) => ({
  live: null,

  startRun: (input) => {
    const statuses: Record<string, StageRunStatus> = {};
    for (const id of input.stageIds) statuses[id] = "pending";
    set({
      live: {
        runId: input.runId,
        pipelineId: input.pipelineId,
        pipelineName: input.pipelineName,
        dryRun: input.dryRun,
        stageIds: input.stageIds,
        stageNames: input.stageNames,
        currentIndex: -1,
        statuses,
        logs: {},
        liveLog: "",
        running: true,
        startedAt: new Date().toISOString(),
        result: null,
        source: input.source ?? "ui",
      },
    });
  },

  stageStart: (index) => {
    const live = get().live;
    if (!live) return;
    const stageId = live.stageIds[index];
    if (!stageId) return;
    set({
      live: {
        ...live,
        currentIndex: index,
        liveLog: "",
        statuses: { ...live.statuses, [stageId]: "running" },
      },
    });
  },

  appendLog: (stageId, chunk) => {
    const live = get().live;
    if (!live) return;
    const prev = live.logs[stageId] ?? "";
    const next = (prev + chunk).slice(-50_000);
    set({
      live: {
        ...live,
        liveLog: live.stageIds[live.currentIndex] === stageId ? next : live.liveLog,
        logs: { ...live.logs, [stageId]: next },
      },
    });
  },

  stageEnd: (index, result) => {
    const live = get().live;
    if (!live) return;
    const stageId = live.stageIds[index];
    if (!stageId) return;
    const status: StageRunStatus = result.ok ? "ok" : "error";
    const output = result.output ?? result.error ?? "";
    set({
      live: {
        ...live,
        statuses: { ...live.statuses, [stageId]: status },
        logs: {
          ...live.logs,
          [stageId]: output || live.logs[stageId] || "",
        },
      },
    });
  },

  finishRun: (result) => {
    const live = get().live;
    if (!live) return;
    set({
      live: {
        ...live,
        running: false,
        result,
      },
    });
  },

  clear: () => set({ live: null }),
}));
