/**
 * @file 子网横向树画布
 * @author Charlie
 * @description 用 @xyflow/react + dagre LR 布局渲染 SubnetTreeNode，支持选中与适应视图。
 */

import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import { type SubnetTreeNode, treeToFlow } from "@/lib/ipcalc";
import { type SubnetFlowNode, SubnetNode } from "./SubnetNode";

const NODE_W = 168;
const NODE_H = 64;
const nodeTypes = { subnet: SubnetNode } satisfies NodeTypes;

function layoutWithDagre(
  nodes: SubnetFlowNode[],
  edges: Edge[],
): { nodes: SubnetFlowNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 36,
    ranksep: 72,
    marginx: 24,
    marginy: 24,
  });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const laidOut: SubnetFlowNode[] = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: (pos?.x ?? 0) - NODE_W / 2,
        y: (pos?.y ?? 0) - NODE_H / 2,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  return { nodes: laidOut, edges };
}

type InnerProps = {
  tree: SubnetTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function SubnetTreeFlowInner({ tree, selectedId, onSelect }: InnerProps) {
  const { fitView } = useReactFlow();
  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => treeToFlow(tree, selectedId),
    [tree, selectedId],
  );

  const laid = useMemo(() => {
    const nodes = rawNodes as SubnetFlowNode[];
    const edges: Edge[] = rawEdges.map((e) => ({
      ...e,
      type: "smoothstep",
      animated: false,
      style: { stroke: "var(--border)", strokeWidth: 1.25 },
    }));
    return layoutWithDagre(nodes, edges);
  }, [rawNodes, rawEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(laid.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laid.edges);

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 30);
    return () => window.clearTimeout(t);
  }, [laid, setNodes, setEdges, fitView]);

  return (
    <ReactFlow
      className="subnet-flow"
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.3}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(tree.id)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} color="var(--border)" />
      <MiniMap
        pannable
        zoomable
        nodeColor={() => "var(--accent)"}
        maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        className="subnet-minimap"
        style={{ width: 100, height: 72 }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

type Props = {
  tree: SubnetTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/** 子网横向树（Provider 包装） */
export function SubnetTreeFlow(props: Props) {
  return (
    <div className="subnet-flow-wrap">
      <ReactFlowProvider>
        <SubnetTreeFlowInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
