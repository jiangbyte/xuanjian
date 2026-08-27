/**
 * @file 本地 / 远程 Agent 运行时入口
 * @author Charlie
 */

import { runLocalReAct } from "@/lib/agent/react";
import { runRemoteAgentTurn } from "@/lib/agent/remoteClient";
import {
  followupAgent,
  injectAgentContext,
  steerAgent,
} from "@/lib/agent/runtime/inbox";
import type { RunAgentInput } from "@/lib/agent/types";

export type { RunAgentInput, RuntimeEvent, ConfirmToolRequest } from "@/lib/agent/types";
export { getBackendBase } from "@/lib/agent/types";
export { steerAgent, injectAgentContext, followupAgent };

/** 执行一轮 Agent（本地走工程级 ReAct；远程走后端 Agent 应用）。 */
export async function runAgentTurn(input: RunAgentInput): Promise<void> {
  if (input.runtime === "remote") {
    await runRemoteAgentTurn(input);
    return;
  }
  await runLocalReAct(input);
}
