/**
 * @file 子网树自定义节点
 * @author Charlie
 * @description React Flow 节点：展示 CIDR、主机数与可选标签，选中态用主题色描边。
 */

import { memo } from "react";
import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { SubnetFlowNodeData } from "@/lib/ipcalc";

export type SubnetFlowNode = Node<SubnetFlowNodeData, "subnet">;

/** 横向树中的单个子网卡片节点 */
function SubnetNodeInner({ data }: NodeProps<SubnetFlowNode>) {
  return (
    <div
      className={`subnet-node ${data.selected ? "subnet-node--selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="subnet-handle" />
      {data.label ? (
        <div className="subnet-node__label">{data.label}</div>
      ) : null}
      <div className="subnet-node__cidr">{data.cidr}</div>
      <div className="subnet-node__meta">
        /{data.prefix} · {data.hostCount} hosts
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="subnet-handle"
      />
    </div>
  );
}

export const SubnetNode = memo(SubnetNodeInner);
