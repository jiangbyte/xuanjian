/**
 * @file 护栏触发时的优雅收尾
 * @author Charlie
 */

import type { MessagePart } from "@/lib/db";
import { chatCompletion } from "@/lib/agent/llm";
import type { AgentActivityPhase, RuntimeEvent } from "@/lib/agent/types";
import type { GuardStopReason } from "@/lib/agent/reactGuards";
import type { LoopOpts } from "@/lib/agent/agent-loop/types";
import type { ProviderBundle } from "@/lib/agent/agent-loop/provider";

function emitActivity(
  emit: (e: RuntimeEvent) => void,
  phase: AgentActivityPhase,
  label: string,
  detail?: string,
) {
  emit({ type: "activity", phase, label, detail });
}

function hasUserFacingText(parts: MessagePart[]): boolean {
  return parts.some(
    (p) =>
      p.type === "text" &&
      p.text.trim() &&
      p.text !== "(无回复)",
  );
}

function buildObservationsForSummary(parts: MessagePart[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.type === "tool_result") {
      chunks.push(`[${p.name}] ${p.result.slice(0, 800)}`);
    } else if (p.type === "subagent" && p.summary) {
      chunks.push(`[${p.label}] ${p.summary.slice(0, 1500)}`);
    }
  }
  return chunks.join("\n").slice(0, 8000);
}

async function tryEarlyStopSummary(
  opts: LoopOpts,
  provider: ProviderBundle,
  assistantParts: MessagePart[],
  guardStop: GuardStopReason | null = null,
): Promise<string | null> {
  const observations = buildObservationsForSummary(assistantParts);
  if (!observations.trim()) return null;

  const incompleteHint = guardStop
    ? "\n\n注意：任务可能尚未完全结束。请明确说明已完成与未完成的部分，并建议用户回复「继续」以接着执行。"
    : "";

  try {
    emitActivity((e) => opts.input.onEvent(e), "summarizing", "整理回复…");
    const reply = await chatCompletion(
      {
        baseUrl: provider.provider.base_url,
        apiFormat: provider.provider.api_format,
        apiKey: provider.apiKey,
        model: provider.modelId,
        thinkingMode: "off",
        maxTokens: provider.maxTokens,
        signal: opts.input.signal,
      },
      [
        {
          role: "system",
          content:
            "你是运维助手。根据已有执行结果，用自然、专业的中文直接回答用户。不要提及步数、循环、工具上限或任何内部机制。若信息不完整，说明已确认的内容，并简要建议下一步。",
        },
        {
          role: "user",
          content: `用户问题：${opts.userText}\n\n已收集的信息：\n${observations}${incompleteHint}\n\n请直接回答用户。`,
        },
      ],
      [],
    );
    const text = reply.text.trim() || reply.thinking.trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function finishGracefully(
  opts: LoopOpts,
  provider: ProviderBundle,
  assistantParts: MessagePart[],
  emit: (e: RuntimeEvent) => void,
): Promise<void> {
  const guardStop = opts.guard.lastStopReason;
  if (hasUserFacingText(assistantParts) && !guardStop) return;

  const summary = await tryEarlyStopSummary(
    opts,
    provider,
    assistantParts,
    guardStop,
  );
  if (summary) {
    assistantParts.push({
      type: "text",
      text: summary,
      agent: opts.agentTag,
    });
    emit({ type: "text", text: summary, agent: opts.agentTag });
    return;
  }

  const fromSub = assistantParts
    .filter(
      (p): p is Extract<MessagePart, { type: "subagent" }> =>
        p.type === "subagent",
    )
    .map((p) => p.summary?.trim())
    .filter(Boolean)
    .join("\n\n");
  if (fromSub) {
    assistantParts.push({
      type: "text",
      text: fromSub,
      agent: opts.agentTag,
    });
    emit({ type: "text", text: fromSub, agent: opts.agentTag });
    return;
  }

  const fallback =
    "根据目前掌握的信息，我还无法给出完整结论。你可以补充一下目标环境，或告诉我希望优先排查哪一块。";
  assistantParts.push({ type: "text", text: fallback, agent: opts.agentTag });
  emit({ type: "text", text: fallback, agent: opts.agentTag });
}

const PLAN_SECTION_RE =
  /(?:^|\n)#+\s*(?:执行计划|建议操作|待执行步骤|操作步骤|后续步骤|清理步骤|执行步骤)(?:[（(][^）)\n]*[）)])?\s*\n([\s\S]*?)(?=\n#+\s[^#]|\n---\s*\n|$)/i;

const LIST_ITEM_RE = /^(\d+[\.\)、]|[*•-])\s+/;

/** 结论/观测类条目，不应进入「计划（未执行）」 */
const FINDING_HINTS =
  /(?:非常健康|无需|正常|为空|占比|可用空间|保持现状|收益有限|无.*(?:堆积|膨胀|告警)|属写操作|计划模式下未执行|\d+(?:\.\d+)?\s*(?:MiB|GiB|KiB|MB|GB|KB)\b|^\s*\/?[\w./-]+\s+\d+(?:\.\d+)?\s*(?:MiB|GiB|KiB))/i;

/** 可执行操作线索 */
const ACTION_HINTS =
  /(?:执行|运行|清理|删除|安装|部署|同步|重启|停止|启动|升级|备份|恢复|配置|修改|创建|移除|卸载|拉取|构建|发布|回滚|扩容|缩容|apt\s+(?:clean|install|update|upgrade|remove)|yum\s+|dnf\s+|docker\s+(?:run|pull|push|compose|exec|rm)|kubectl\s+|systemctl\s+|chmod\s+|chown\s+|rm\s+-|mv\s+|cp\s+|sync_to_remote|terminal_run|run_script|write_remote_file|deploy\b|upload_)/i;

function stripListMarker(line: string): string {
  return line.replace(LIST_ITEM_RE, "").trim();
}

function extractListItems(block: string): string[] {
  return block
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => LIST_ITEM_RE.test(l))
    .map(stripListMarker)
    .filter(Boolean);
}

function isActionablePlanLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 6) return false;
  if (FINDING_HINTS.test(t)) return false;
  return ACTION_HINTS.test(t);
}

/** 从回复中拆分正文与可执行计划（计划模式专用） */
export function splitPlanFromReply(text: string): {
  body: string;
  planItems: string[] | null;
} {
  const trimmed = text.trim();
  if (!trimmed) return { body: "", planItems: null };

  const sectionMatch = trimmed.match(PLAN_SECTION_RE);
  if (sectionMatch?.index != null) {
    const planItems = extractListItems(sectionMatch[1]).filter(isActionablePlanLine);
    const body = (
      trimmed.slice(0, sectionMatch.index) +
      trimmed.slice(sectionMatch.index + sectionMatch[0].length)
    )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      body: body || trimmed,
      planItems: planItems.length ? planItems : null,
    };
  }

  const actionable = extractListItems(trimmed).filter(isActionablePlanLine);
  return {
    body: trimmed,
    planItems: actionable.length ? actionable : null,
  };
}

/** 一键执行计划时发给 Agent 的用户消息 */
export function buildPlanExecutePrompt(items: string[]): string {
  const steps = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
  return `请按以下执行计划逐步执行（用户已切换为确认执行模式并授权执行）。需要写操作或终端命令时按流程执行；每步完成后简要汇报，全部完成后给出总结。

${steps}`;
}

/** @deprecated 使用 splitPlanFromReply */
export function tryExtractPlan(text: string): string[] | null {
  return splitPlanFromReply(text).planItems;
}
