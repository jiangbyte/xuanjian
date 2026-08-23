/**
 * @file Agent 系统提示词（与 ReAct 实际下发一致，供上下文估算复用）
 * @author Charlie
 */

import { executionSemanticsBlock } from "@/lib/agent/executionContext";
import type { AgentPermissionMode } from "@/lib/db";

/** 编排器 system prompt 基线（不含动态执行环境，供 token 估算） */
export function buildOrchestratorSystemPrompt(
  mode: AgentPermissionMode,
): string {
  const modeLine =
    mode === "plan"
      ? "【权限=计划】禁止写操作与 terminal SubAgent 执行命令；可用 inspector 只读收集后给出分步计划。"
      : mode === "confirm"
        ? "【权限=确认执行】写操作与 terminal SubAgent 的命令会要求用户确认。"
        : "【权限=完全执行】可直接派发执行；危险命令仍会二次确认。";

  return [
    "你是玄鉴 Orchestrator（编排 Agent）。",
    "复杂任务请拆解并用 run_subagent 派发给专职 SubAgent，而不是自己一把梭：",
    "- inspector：只读巡检（主机/会话/指标/读终端/脚本库/历史命令）",
    "- terminal：在可见终端执行命令，或 run_script 复用脚本库",
    "- deploy：工作空间同步与远程部署（需 SSH）",
    "- 复杂跨平面任务（WSL 编译→传远程→部署）优先 get_pipeline 阅读各阶段 prompt，再 run_pipeline；或在 /pipelines 配置后执行。",
    "- docker：在活动会话（WSL/SSH）内执行 Docker CLI",
    "- analyst：归纳结论与建议",
    "本地能力：list_scripts / get_script 查阅脚本库；list_pipelines / run_pipeline 执行多阶段流水线；list_cmd_history 查阅历史命令；list_sessions 查看各标签 tab_id 与执行平面。",
    "简单一问一答可直接用本地工具，不必强行派发。",
    "遵循 ReAct：Thought → Action → Observation；禁止编造 Observation。",
    "任务完成、信息已足够或无法继续时，必须用自然语言给出最终回答，不要再调用工具。",
    "禁止对同一工具使用相同参数反复调用；若 Observation 已回答子问题，立即进入下一步或总结。",
    "优先中文。",
    modeLine,
    "",
    executionSemanticsBlock(),
  ].join("\n");
}

/** 编排器 + 动态执行环境（ReAct 实际下发） */
export async function buildOrchestratorSystemWithContext(
  mode: AgentPermissionMode,
): Promise<string> {
  const { buildExecutionContextBlock } = await import(
    "@/lib/agent/executionContext"
  );
  const ctx = await buildExecutionContextBlock();
  return [buildOrchestratorSystemPrompt(mode), "", ctx].join("\n");
}

/** SubAgent system + 动态执行环境 */
export async function buildSubAgentSystemWithContext(
  ...sections: string[]
): Promise<string> {
  const { buildExecutionContextBlock } = await import(
    "@/lib/agent/executionContext"
  );
  const ctx = await buildExecutionContextBlock();
  return [...sections.filter(Boolean), "", ctx].join("\n");
}
