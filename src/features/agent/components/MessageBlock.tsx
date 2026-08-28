/**
 * @file 对话消息块（可选中 + 一键复制）
 */

import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AgentPermissionMode, MessagePart } from "@/lib/db";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import { cn } from "@/lib/utils";
import { PartView } from "./PartView";
import { toolLabel } from "./toolLabel";

function partsToCopyText(parts: MessagePart[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    switch (p.type) {
      case "text":
        chunks.push(p.text);
        break;
      case "thinking":
        chunks.push(`Thought\n${p.text}`);
        break;
      case "tool_call":
        chunks.push(
          `Action · ${toolLabel(p.name, p.args)}\n${JSON.stringify(p.args)}`,
        );
        break;
      case "tool_result":
        chunks.push(`Observation · ${p.name}\n${p.result}`);
        break;
      case "tool_pending":
        chunks.push(
          `Pending · ${toolLabel(p.name, p.args)}\n${JSON.stringify(p.args)}`,
        );
        break;
      case "plan":
        chunks.push(
          p.items.map((it, i) => `${i + 1}. ${it.replace(/\n+/g, " ")}`).join("\n"),
        );
        break;
      case "subagent": {
        const lines = [`SubAgent · ${p.label}`, p.task];
        if (p.summary) lines.push(p.summary);
        chunks.push(lines.join("\n"));
        break;
      }
      case "status":
        chunks.push(p.text);
        break;
      default:
        break;
    }
  }
  return chunks.filter((c) => c.trim().length > 0).join("\n\n");
}

function CopyMessageButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await clipboardWriteText(body);
      setCopied(true);
      toast.success(t("terminal.aiCopied"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("termTab.copyFail"));
    }
  }, [text, t]);

  if (!text.trim()) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "h-6 w-6 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
        copied && "opacity-100 text-primary",
      )}
      aria-label={t("terminal.aiCopy")}
      title={t("terminal.aiCopy")}
      onClick={(e) => {
        e.stopPropagation();
        void onCopy();
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </Button>
  );
}

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
  const copyText = partsToCopyText(parts);

  if (role === "user") {
    const text = parts
      .filter(
        (p): p is Extract<MessagePart, { type: "text" }> => p.type === "text",
      )
      .map((p) => p.text)
      .join("\n");
    return (
      <div className="group ml-4 flex max-w-full min-w-0 items-start justify-end gap-1">
        <CopyMessageButton text={copyText || text} />
        <div className="min-w-0 max-w-full select-text rounded-lg rounded-br-sm bg-primary/10 px-2.5 py-1.5 text-[12px] leading-[1.55] text-foreground break-words [overflow-wrap:anywhere]">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="group relative mr-1 min-w-0 max-w-full space-y-1.5 text-[12px] leading-[1.55]">
      <div className="absolute top-0 right-0 z-10">
        <CopyMessageButton text={copyText} />
      </div>
      <div className="min-w-0 max-w-full select-text space-y-1.5 pr-7">
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
    </div>
  );
}
