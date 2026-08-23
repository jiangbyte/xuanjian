/**
 * @file Pipeline 流程图画布
 * @author Charlie
 */

import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useMemo } from "react";
import "@xyflow/react/dist/style.css";
import {
  endpointLabel,
  type PipelineStage,
  type PipelineStageType,
} from "@/lib/pipeline/types";
import type { StageRunStatus } from "@/lib/pipeline/runStore";
import { cn } from "@/lib/utils";

const NODE_W = 220;
const NODE_H = 72;

const STAGE_RUNNING: Record<PipelineStageType, string> = {
  exec: "border-blue-500 ring-2 ring-blue-500/40",
  transfer: "border-amber-500 ring-2 ring-amber-500/40",
  sync: "border-emerald-500 ring-2 ring-emerald-500/40",
  batch: "border-violet-500 ring-2 ring-violet-500/40",
};

const STAGE_DONE: Record<PipelineStageType, string> = {
  exec: "border-emerald-600/70 bg-emerald-500/5",
  transfer: "border-emerald-600/70 bg-emerald-500/5",
  sync: "border-emerald-600/70 bg-emerald-500/5",
  batch: "border-emerald-600/70 bg-emerald-500/5",
};

const STAGE_FAILED: Record<PipelineStageType, string> = {
  exec: "border-destructive/70 bg-destructive/5",
  transfer: "border-destructive/70 bg-destructive/5",
  sync: "border-destructive/70 bg-destructive/5",
  batch: "border-destructive/70 bg-destructive/5",
};

type StageNodeData = {
  stage: PipelineStage;
  index: number;
  selected: boolean;
  runStatus?: StageRunStatus;
};

function stageSubtitle(stage: PipelineStage): string {
  if (stage.prompt?.trim()) {
    const p = stage.prompt.trim();
    return p.length > 48 ? `${p.slice(0, 48)}…` : p;
  }
  switch (stage.type) {
    case "exec":
      return endpointLabel(stage.endpoint);
    case "transfer":
      return `${endpointLabel(stage.source)} → ${endpointLabel(stage.target)}`;
    case "sync":
      return `workspace #${stage.workspace_id}`;
    case "batch":
      return `script #${stage.script_id}`;
    default:
      return "";
  }
}

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  const { stage, index, selected, runStatus } = data;
  const base =
    runStatus === "running"
      ? STAGE_RUNNING[stage.type]
      : runStatus === "ok"
        ? STAGE_DONE[stage.type]
        : runStatus === "error"
          ? STAGE_FAILED[stage.type]
          : {
              exec: "border-blue-500/60 bg-blue-500/10",
              transfer: "border-amber-500/60 bg-amber-500/10",
              sync: "border-emerald-500/60 bg-emerald-500/10",
              batch: "border-violet-500/60 bg-violet-500/10",
            }[stage.type];
  return (
    <div
      className={cn(
        "rounded-none border-2 px-3 py-2 text-left shadow-sm",
        base,
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        runStatus === "running" && "animate-pulse",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {index + 1} · {stage.type}
      </div>
      <div className="truncate text-sm font-semibold">{stage.name}</div>
      <div className="truncate text-xs text-muted-foreground">
        {stageSubtitle(stage)}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

const nodeTypes = { stage: StageNode };

function layoutStages(stages: PipelineStage[]): {
  nodes: Node<StageNodeData>[];
  edges: Edge[];
} {
  const nodes: Node<StageNodeData>[] = stages.map((stage, index) => ({
    id: stage.id,
    type: "stage",
    position: { x: 0, y: 0 },
    data: { stage, index, selected: false },
  }));
  const edges: Edge[] = stages.slice(1).map((stage, i) => ({
    id: `e-${stages[i].id}-${stage.id}`,
    source: stages[i].id,
    target: stage.id,
    type: "smoothstep",
    animated: true,
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
  }));

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 56, marginx: 32, marginy: 32 });
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const laid = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: (pos?.x ?? 0) - NODE_W / 2,
        y: (pos?.y ?? 0) - NODE_H / 2,
      },
    };
  });
  return { nodes: laid, edges };
}

type Props = {
  stages: PipelineStage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  stageStatuses?: Record<string, StageRunStatus>;
};

function PipelineFlowInner({
  stages,
  selectedId,
  onSelect,
  stageStatuses,
}: Props) {
  const { nodes: rawNodes, edges } = useMemo(
    () => layoutStages(stages),
    [stages],
  );

  const nodes = useMemo(
    () =>
      rawNodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === selectedId,
          runStatus: stageStatuses?.[n.id],
        },
      })),
    [rawNodes, selectedId, stageStatuses],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      fitView
      minZoom={0.4}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/** 纵向 Pipeline 流程图 */
export function PipelineFlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <div className="h-full min-h-[320px] w-full">
        <PipelineFlowInner key={props.stages.map((s) => s.id).join(",")} {...props} />
      </div>
    </ReactFlowProvider>
  );
}
