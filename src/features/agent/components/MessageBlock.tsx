/**
 * @file 对话消息块
 */

import type { AgentPermissionMode, MessagePart } from "@/lib/db";
import { PartView } from "./PartView";

export function MessageBlock({
  messageId,
  role,
  parts,
  onConfirm,
  onExecutePlan,
  executedPlanKeys,
  busy,
  permissionMode,
}: {
  messageId: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  onConfirm?: (id: string, ok: boolean) => void;
  onExecutePlan?: (items: string[], planKey: string) => void;
  executedPlanKeys?: Set<string>;
  busy?: boolean;
  permissionMode?: AgentPermissionMode;
}) {
  if (role === "user") {
    const text = parts
      .filter(
        (p): p is Extract<MessagePart, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("\n");
    return (
      <div className="ml-4 max-w-full min-w-0 rounded-lg rounded-br-sm bg-primary/10 px-2.5 py-1.5 text-[12px] leading-[1.55] text-foreground break-words [overflow-wrap:anywhere]">
        {text}
      </div>
    );
  }
  return (
    <div className="mr-1 min-w-0 max-w-full space-y-1.5 text-[12px] leading-[1.55]">
      {parts.map((p, i) => (
        <PartView
          key={i}
          part={p}
          planKey={p.type === "plan" ? `${messageId}:${i}` : undefined}
          onConfirm={onConfirm}
          onExecutePlan={onExecutePlan}
          executedPlanKeys={executedPlanKeys}
          busy={busy}
          permissionMode={permissionMode}
        />
      ))}
    </div>
  );
}
