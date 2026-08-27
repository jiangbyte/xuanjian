/**
 * @file 流式回复块组装器
 * @author Charlie
 */

import type {
  AnthropicContentBlock,
  LlmToolCall,
  NormalizedLlmReply,
} from "@/lib/agent/llm";
import { parseLlmUsage } from "@/lib/agent/contextBudget";

export class BlockAssembler {
  private thinking = "";
  private text = "";
  private toolCalls: LlmToolCall[] = [];
  private anthropicContent: AnthropicContentBlock[] = [];
  private raw: unknown;

  pushThinking(delta: string): void {
    if (!delta) return;
    this.thinking += delta;
    const last = this.anthropicContent[this.anthropicContent.length - 1];
    if (last?.type === "thinking") {
      last.thinking = (last.thinking ?? "") + delta;
    } else {
      this.anthropicContent.push({ type: "thinking", thinking: delta });
    }
  }

  pushText(delta: string): void {
    if (!delta) return;
    this.text += delta;
    const last = this.anthropicContent[this.anthropicContent.length - 1];
    if (last?.type === "text") {
      last.text += delta;
    } else {
      this.anthropicContent.push({ type: "text", text: delta });
    }
  }

  setToolCalls(calls: LlmToolCall[]): void {
    this.toolCalls = calls;
    this.anthropicContent = this.anthropicContent.filter(
      (b) => b.type !== "tool_use",
    );
    for (const tc of calls) {
      try {
        this.anthropicContent.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      } catch {
        this.anthropicContent.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: {},
        });
      }
    }
  }

  setRaw(raw: unknown, apiFormat: string): void {
    this.raw = raw;
    const usage = parseLlmUsage(raw, apiFormat);
    if (usage) this._usage = usage;
  }

  setUsage(usage: NonNullable<NormalizedLlmReply["usage"]>): void {
    this._usage = usage;
  }

  private _usage: NormalizedLlmReply["usage"] = null;

  finalize(_apiFormat: string, stripThinking: boolean): NormalizedLlmReply {
    const thinking = stripThinking ? "" : this.thinking;
    const anthropicContent =
      this.anthropicContent.length > 0 ? this.anthropicContent : undefined;
    return {
      thinking,
      text: this.text,
      toolCalls: this.toolCalls,
      anthropicContent,
      usage: this._usage,
      raw: this.raw,
    };
  }
}
