/**
 * @file 结果分析 SubAgent
 * @author Charlie
 */

import type { SubAgentModule } from "@/lib/agent/subagents/types";

export const analystSubAgent: SubAgentModule = {
  def: {
    kind: "analyst",
    label: "结果分析",
    description: "根据已有 Observation 做结论与建议",
    toolNames: [
      "terminal_tail",
      "list_sessions",
      "list_scripts",
      "get_script",
      "list_cmd_history",
      "search_notes",
      "search_session_logs",
      "search_cmd_history",
    ],
    systemExtra:
      "你是分析 SubAgent。基于编排器提供的上下文与必要时再读的终端尾部、脚本库、历史命令、笔记与录制，给出结论、风险与下一步建议，不要随意执行命令。",
    maxRounds: 3,
  },
};
