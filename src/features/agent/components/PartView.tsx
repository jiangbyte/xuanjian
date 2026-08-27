/**
 * @file MessagePart 渲染
 */

import { Bot, Loader2, Play, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import type { AgentPermissionMode, MessagePart } from "@/lib/db";
import { cn } from "@/lib/utils";
import { toolLabel } from "./toolLabel";

export function PartView({
  part,
  planKey,
  onConfirm,
  onExecutePlan,
  executedPlanKeys,
  busy,
  permissionMode,
}: {
  part: MessagePart;
  planKey?: string;
  onConfirm?: (id: string, ok: boolean) => void;
  onExecutePlan?: (items: string[], planKey: string) => void;
  executedPlanKeys?: Set<string>;
  busy?: boolean;
  permissionMode?: AgentPermissionMode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(part.type === "thinking");
  if (part.type === "text") {
    return (
      <MarkdownViewer
        source={part.text}
        density="compact"
        className="text-sidebar-foreground"
      />
    );
  }
  if (part.type === "thinking") {
    return (
      <button
        type="button"
        className="w-full rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 text-left text-[12px] leading-[1.55] text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-foreground/80">
          Thought
          {part.agent && part.agent !== "orchestrator"
            ? ` · ${part.agent}`
            : ""}
        </span>
        {open ? (
          <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-[1.55]">
            {part.text}
          </pre>
        ) : (
          <span className="ml-1 opacity-70">
            {part.text.slice(0, 64)}
            {part.text.length > 64 ? "…" : ""}
          </span>
        )}
      </button>
    );
  }
  if (part.type === "subagent") {
    return (
      <div
        className={cn(
          "rounded-md border px-2 py-1.5 text-[11px]",
          part.status === "running" && "border-primary/40 bg-primary/5",
          part.status === "done" && "border-border bg-muted/30",
          part.status === "error" && "border-destructive/40 bg-destructive/5",
        )}
      >
        <div className="flex items-center gap-1.5 font-medium">
          {part.status === "running" ? (
            <Loader2 size={12} className="animate-spin text-primary" />
          ) : (
            <Bot size={12} className="text-primary" />
          )}
          <span>
            SubAgent · {part.label}
            {part.status === "running"
              ? " · 执行中"
              : part.status === "error"
                ? " · 失败"
                : " · 完成"}
          </span>
        </div>
        <div className="mt-0.5 text-muted-foreground">{part.task}</div>
        {part.summary ? (
          <div className="mt-1.5 border-t border-border/60 pt-1.5">
            <MarkdownViewer source={part.summary} density="compact" />
          </div>
        ) : null}
        {part.children && part.children.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              展开子轨迹 ({part.children.length})
            </summary>
            <div className="mt-1 space-y-1 border-l border-border pl-2">
              {part.children.map((c, i) => (
                <PartView key={i} part={c} onConfirm={onConfirm} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    );
  }
  if (part.type === "plan") {
    const md = part.items
      .map((it, i) => `${i + 1}. ${it.replace(/\n+/g, " ")}`)
      .join("\n");
    const executed = planKey ? executedPlanKeys?.has(planKey) : false;
    const executeLabel =
      permissionMode === "plan"
        ? t("terminal.aiPlanExecuteSwitch")
        : t("terminal.aiPlanExecute");
    return (
      <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-[11px]">
        <div className="mb-1 font-medium">{t("terminal.aiPlanTitle")}</div>
        <MarkdownViewer
          source={md}
          density="compact"
          className="text-sidebar-foreground"
        />
        {part.items.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              disabled={Boolean(busy || executed)}
              onClick={() => {
                if (planKey) onExecutePlan?.(part.items, planKey);
              }}
            >
              <Play size={11} />
              {executed ? t("terminal.aiPlanExecuted") : executeLabel}
            </Button>
            {permissionMode === "plan" && !executed ? (
              <span className="text-[10px] text-muted-foreground">
                {t("terminal.aiPlanExecuteHint")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  if (part.type === "tool_pending") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
        <div className="font-medium">
          待确认{part.dangerous ? " · 危险" : ""}
          {part.agent && part.agent !== "orchestrator"
            ? ` · ${part.agent}`
            : ""}
        </div>
        <div className="mt-0.5 text-foreground">
          {toolLabel(part.name, part.args)}
        </div>
        <pre className="mt-1 max-h-20 overflow-auto font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(part.args, null, 0)}
        </pre>
        <div className="mt-1.5 flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onConfirm?.(part.id, true)}
          >
            允许执行
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            onClick={() => onConfirm?.(part.id, false)}
          >
            拒绝
          </Button>
        </div>
      </div>
    );
  }
  if (part.type === "tool_call") {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] leading-[1.55]">
        <Wrench size={12} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="font-medium">
            Action · {toolLabel(part.name, part.args)}
          </div>
          <pre className="truncate font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(part.args)}
          </pre>
        </div>
      </div>
    );
  }
  if (part.type === "tool_result") {
    return (
      <details className="rounded-md bg-muted/40 px-2 py-1.5 text-[12px] leading-[1.55]">
        <summary className="cursor-pointer font-medium">
          Observation · {part.name}
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">
          {part.result}
        </pre>
      </details>
    );
  }
  if (part.type === "status") {
    return (
      <div className="text-[11px] font-medium text-muted-foreground">
        {part.text}
      </div>
    );
  }
  return null;
}
