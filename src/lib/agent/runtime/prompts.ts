/**
 * @file Agent 系统提示词（与 ReAct 实际下发一致，供上下文估算复用）
 * @author Charlie
 */

import { executionSemanticsBlock } from "./executionContext";
import type { AgentPermissionMode } from "@/lib/db";

/** 编排器 system prompt 基线（不含动态执行环境，供 token 估算） */
export function buildOrchestratorSystemPrompt(
  mode: AgentPermissionMode,
): string {
  const modeLine =
    mode === "plan"
      ? "【权限=计划】禁止写操作与 terminal SubAgent 执行命令；可用 inspector 只读收集。最终回复先写结论与依据；若确有需切换至确认/执行模式才会动手的操作，单独用「## 执行计划」标题列出可执行步骤（命令或工具名+要点）。无需清理/无写操作时省略该节，不要把巡检结论或文件大小清单当作计划项。"
      : mode === "confirm"
        ? "【权限=确认执行】写操作与 terminal SubAgent 的命令会要求用户确认。"
        : "【权限=完全执行】可直接派发执行；危险命令仍会二次确认。";

  return [
    "你是玄鉴 Orchestrator（编排 Agent）。",
    "复杂任务请拆解并用 run_subagent 派发给专职 SubAgent，而不是自己一把梭：",
    "- inspector：只读巡检（主机/会话/指标/读终端/脚本库/历史命令）",
    "- terminal：在 Agent 下栏终端执行命令（用户可见），或 run_script 复用脚本库",
    "- deploy：工作空间同步与远程部署（需 SSH）",
    "- 复杂跨平面任务（WSL 编译→传远程→部署）请拆解为 SubAgent 多步执行（terminal / deploy）。",
    "- docker：在活动会话（WSL/SSH）内执行 Docker CLI",
    "- analyst：归纳结论与建议",
    "所有工具仅在当前焦点终端标签执行，禁止跨标签。WSL/SSH 须用户先切换到对应标签。",
    "本地能力：list_scripts / get_script 查阅脚本库；list_cmd_history 查阅历史；list_sessions 查看焦点标签。",
    "简单一问一答可直接用本地工具，不必强行派发。",
    "遵循 ReAct：Thought → Action → Observation；禁止编造 Observation。",
    "长任务请先分段思考：列出检查项/步骤清单，再逐步调用工具；每步根据 Observation 更新计划，避免一次输出过长结论。",
    "多步任务（部署/同步/清理等）：必须按步骤连续执行直至完成或明确受阻；sync_to_remote 的 dry_run 只是预览，完成后须继续实际 sync、部署与验证，不得在仅完成 dry_run 后结束。",
    "批量文件同步用 sync_to_remote，不要 read_file + write_remote_file 逐文件搬运。",
    "docker pull/compose 等长任务：terminal_run/terminal_tail 的 wait_ms 为上限，出现 shell 提示符或输出稳定后会自动提前返回；registry 超时时建议配置镜像加速。",
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
  const { buildExecutionContextBlock } = await import("./executionContext");
  const ctx = await buildExecutionContextBlock();
  return [buildOrchestratorSystemPrompt(mode), "", ctx].join("\n");
}

/** SubAgent system + 动态执行环境 */
export async function buildSubAgentSystemWithContext(
  ...sections: string[]
): Promise<string> {
  const { buildExecutionContextBlock } = await import("./executionContext");
  const ctx = await buildExecutionContextBlock();
  return [...sections.filter(Boolean), "", ctx].join("\n");
}
