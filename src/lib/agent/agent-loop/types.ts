/**
 * @file Agent 循环类型与 Inbox
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { ReactLoopGuard } from "@/lib/agent/reactGuards";
import type { RunAgentInput, RuntimeEvent } from "@/lib/agent/types";
import type { AgentToolDef } from "@/lib/agent/tools";
import type { ProviderBundle } from "@/lib/agent/agent-loop/provider";
import type { SessionStore } from "@/lib/agent/session";

export type InboxTarget = "next-turn" | "next-step";

export type InboxMessage = {
  target: InboxTarget;
  content: string;
  wake: boolean;
};

export class AgentInbox {
  readonly nextTurn: InboxMessage[] = [];
  readonly nextStep: InboxMessage[] = [];
  readonly injectQueue: InboxMessage[] = [];

  followup(content: string): void {
    this.nextTurn.push({ target: "next-turn", content, wake: true });
  }

  steer(content: string): void {
    this.nextStep.push({ target: "next-step", content, wake: true });
  }

  inject(content: string): void {
    this.injectQueue.push({ target: "next-step", content, wake: false });
  }

  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0;
  }

  drainInject(): string[] {
    const items = this.injectQueue.splice(0);
    return items.map((m) => m.content);
  }

  claim(target: InboxTarget): string | null {
    const q = target === "next-turn" ? this.nextTurn : this.nextStep;
    const item = q.shift();
    return item?.content ?? null;
  }
}

export type LoopOpts = {
  input: RunAgentInput;
  provider: ProviderBundle;
  system: string;
  tools: AgentToolDef[];
  userText: string;
  history: LlmMessage[];
  maxRounds: number;
  agentTag: string;
  agentLabel: string;
  persist: boolean;
  depth: number;
  guard: ReactLoopGuard;
  session?: SessionStore;
  inbox?: AgentInbox;
  lastUsage?: import("@/lib/agent/contextBudget").LlmUsage | null;
  sampledSurfaceTokens?: number | null;
  inTurnParts?: import("@/lib/db").MessagePart[];
};

export type AgentHandle = {
  tag: string;
  label: string;
  depth: number;
};

export type StepEmit = (e: RuntimeEvent) => void;
