/**
 * @file Agent 扩展点注册（瀑布式中间件）
 * @author Charlie
 */

import type { LlmMessage } from "@/lib/agent/llm";
import type { AgentToolDef } from "@/lib/agent/tools";
import type { ToolExecContext } from "@/lib/agent/tools/types";

export type HookPoint =
  | "agent/pre-step"
  | "agent/pre-request"
  | "tools/pre-execute"
  | "tools/post-execute";

export type PreStepDecision =
  | { kind: "continue" }
  | { kind: "reject"; reason: string }
  | { kind: "inject"; messages: LlmMessage[] };

export type PreStepContext = {
  turn: number;
  step: number;
  messages: LlmMessage[];
};

export type PreRequestContext = {
  messages: LlmMessage[];
  tools: AgentToolDef[];
};

export type PreExecuteContext = {
  name: string;
  args: Record<string, unknown>;
  execCtx: ToolExecContext;
};

export type PreExecuteDecision =
  | { kind: "allow" }
  | { kind: "deny"; result: string }
  | { kind: "ask"; dangerous?: boolean };

export type PostExecuteContext = {
  name: string;
  args: Record<string, unknown>;
  result: string;
  execCtx: ToolExecContext;
};

type PreStepHook = (
  ctx: PreStepContext,
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>;

type PreRequestHook = (
  ctx: PreRequestContext,
  next: () => Promise<PreRequestContext>,
) => Promise<PreRequestContext>;

type PreExecuteHook = (
  ctx: PreExecuteContext,
  next: () => Promise<PreExecuteDecision>,
) => Promise<PreExecuteDecision>;

type PostExecuteHook = (
  ctx: PostExecuteContext,
  next: () => Promise<string>,
) => Promise<string>;

const preStepHooks: PreStepHook[] = [];
const preRequestHooks: PreRequestHook[] = [];
const preExecuteHooks: PreExecuteHook[] = [];
const postExecuteHooks: PostExecuteHook[] = [];

export function useHook<K extends HookPoint>(
  point: K,
  fn: K extends "agent/pre-step"
    ? PreStepHook
    : K extends "agent/pre-request"
      ? PreRequestHook
      : K extends "tools/pre-execute"
        ? PreExecuteHook
        : PostExecuteHook,
): () => void {
  const list =
    point === "agent/pre-step"
      ? preStepHooks
      : point === "agent/pre-request"
        ? preRequestHooks
        : point === "tools/pre-execute"
          ? preExecuteHooks
          : postExecuteHooks;
  (list as PreStepHook[]).push(fn as PreStepHook);
  return () => {
    const idx = (list as PreStepHook[]).indexOf(fn as PreStepHook);
    if (idx >= 0) list.splice(idx, 1);
  };
}

export async function runPreStepHooks(
  ctx: PreStepContext,
): Promise<PreStepDecision> {
  let idx = 0;
  const next = async (): Promise<PreStepDecision> => {
    if (idx >= preStepHooks.length) return { kind: "continue" };
    const hook = preStepHooks[idx++];
    return hook(ctx, next);
  };
  return next();
}

export async function runPreRequestHooks(
  ctx: PreRequestContext,
): Promise<PreRequestContext> {
  let idx = 0;
  const next = async (): Promise<PreRequestContext> => {
    if (idx >= preRequestHooks.length) return ctx;
    const hook = preRequestHooks[idx++];
    return hook(ctx, next);
  };
  return next();
}

export async function runPreExecuteHooks(
  ctx: PreExecuteContext,
): Promise<PreExecuteDecision> {
  let idx = 0;
  const next = async (): Promise<PreExecuteDecision> => {
    if (idx >= preExecuteHooks.length) return { kind: "allow" };
    const hook = preExecuteHooks[idx++];
    return hook(ctx, next);
  };
  return next();
}

export async function runPostExecuteHooks(
  ctx: PostExecuteContext,
  initialResult: string,
): Promise<string> {
  let idx = 0;
  const next = async (): Promise<string> => {
    if (idx >= postExecuteHooks.length) return initialResult;
    const hook = postExecuteHooks[idx++];
    return hook(ctx, next);
  };
  return next();
}

export function clearAllHooks(): void {
  preStepHooks.length = 0;
  preRequestHooks.length = 0;
  preExecuteHooks.length = 0;
  postExecuteHooks.length = 0;
}
