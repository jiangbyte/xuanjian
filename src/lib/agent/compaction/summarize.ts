/**
 * @file 长会话摘要压缩（复用请求前缀 + region 选择）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import { chatCompletion } from "@/lib/agent/llm";
import type { ProviderBundle } from "@/lib/agent/agent-loop/provider";
import { selectCompactableRange } from "@/lib/agent/compaction/region";
import {
  sanitizeLlmMessagesForApi,
  stripLeadingOrphanTools,
} from "@/lib/agent/compaction/tool-pairing";
import type { AgentToolDef } from "@/lib/agent/tools";

const COMPACTION_INSTRUCTION = `请将以上对话历史中将被移除的部分压缩为简洁中文检查点摘要。
必须保留：用户主要目标、主机/路径、已执行命令、错误信息、关键结论、未完成项。
输出格式：
Primary Request: ...
Files/Paths: ...
Errors: ...
Completed: ...
Next Step: ...
不要 markdown 标题，不要编造未出现的信息。`;

export async function summarizeForCompaction(
  provider: ProviderBundle,
  messages: LlmMessage[],
  system: string,
  tools: AgentToolDef[],
  signal?: AbortSignal,
  retainRatio = 0.16,
): Promise<string> {
  const range = selectCompactableRange(messages, { retainRatio });
  if (!range) return "";

  const toSummarize = messages.slice(range.start, range.keepFrom);
  if (!toSummarize.length) return "";

  // 对齐 dsh：摘要请求只回放「待压缩区间」的文本片段，不把 tool_result 原样送入 API
  const replayPrefix = messages
    .slice(0, range.start)
    .filter((m) => m.role !== "system");

  const reply = await chatCompletion(
    {
      baseUrl: provider.provider.base_url,
      apiFormat: provider.provider.api_format,
      apiKey: provider.apiKey,
      model: provider.modelId,
      thinkingMode: "off",
      maxTokens: provider.maxTokens,
      signal,
    },
    sanitizeLlmMessagesForApi([
      { role: "system", content: system },
      ...replayPrefix,
      {
        role: "user",
        content: `${COMPACTION_INSTRUCTION}\n\n待压缩片段（共 ${toSummarize.length} 条消息）：\n${snippetFromMessages(toSummarize)}`,
      },
    ]),
    tools,
  );
  return (reply.text || reply.thinking).trim();
}

function snippetFromMessages(msgs: LlmMessage[]): string {
  const lines: string[] = [];
  for (const m of msgs) {
    if (m.role === "user" && typeof m.content === "string") {
      if (m.content.includes("<compacted-summary>")) {
        lines.push(`[compacted] ${m.content.slice(0, 600)}`);
      } else {
        lines.push(`[user] ${m.content.slice(0, 800)}`);
      }
    } else if (m.role === "assistant") {
      const t = typeof m.content === "string" ? m.content : "";
      const toolNames = m.tool_calls?.map((tc) => tc.function.name).join(", ");
      lines.push(`[assistant] ${t.slice(0, 400)}${toolNames ? ` tools:${toolNames}` : ""}`);
    } else if (m.role === "tool") {
      lines.push(
        `[tool:${m.name ?? "?"}] ${String(m.content).slice(0, 600)}`,
      );
    }
  }
  return lines.join("\n").slice(0, 12_000);
}

/** 用摘要替换选中区间，保留尾部 */
export function applyCompactionToMessages(
  messages: LlmMessage[],
  summary: string,
  retainRatio = 0.16,
): LlmMessage[] {
  const range = selectCompactableRange(messages, { retainRatio });
  if (!range || !summary.trim()) return messages;

  const system = messages.filter((m) => m.role === "system");
  const head = messages.slice(0, range.start);
  const tail = messages.slice(range.keepFrom);
  const merged = [
    ...system.length ? system : head.filter((m) => m.role === "system"),
    ...head.filter((m) => m.role !== "system"),
    {
      role: "user" as const,
      content: `<compacted-summary>\n${summary}\n</compacted-summary>`,
    },
    ...tail,
  ];
  return sanitizeLlmMessagesForApi(
    stripLeadingOrphanTools(merged, system.length + head.filter((m) => m.role !== "system").length + 1),
  );
}

export async function compactIfNeeded(
  input: {
    provider: ProviderBundle;
    system: string;
    tools: AgentToolDef[];
    messages: LlmMessage[];
    signal?: AbortSignal;
    retainRatio?: number;
    force?: boolean;
  },
): Promise<{ messages: LlmMessage[]; summary?: string } | null> {
  const { pruneOldToolResults } = await import("@/lib/agent/compaction/prune");
  let msgs = sanitizeLlmMessagesForApi(input.messages);
  msgs = pruneOldToolResults(msgs);

  const summary = await summarizeForCompaction(
    input.provider,
    msgs,
    input.system,
    input.tools,
    input.signal,
    input.force ? 0 : (input.retainRatio ?? 0.16),
  );
  if (!summary) return { messages: msgs };

  msgs = applyCompactionToMessages(
    msgs,
    summary,
    input.force ? 0 : (input.retainRatio ?? 0.16),
  );
  return { messages: msgs, summary };
}
