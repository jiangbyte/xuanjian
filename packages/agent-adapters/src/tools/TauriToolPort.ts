/**
 * @file 工具端口：桥接现有 tools pipeline
 */

import type {
  AgentPermissionMode,
  ConfirmToolRequest,
  CoreToolDef,
  ToolPort,
} from "@xuanjian/agent-core";
import { getAllTools, isWriteTool } from "@/lib/agent/tools/registry";
import { executeToolViaPipeline } from "@/lib/agent/tools/pipeline";
import { isDangerousCommand } from "@/lib/agent/tools/types";

export function createTauriToolPort(): ToolPort {
  return {
    listTools(permissionMode: AgentPermissionMode): CoreToolDef[] {
      return getAllTools(permissionMode) as unknown as CoreToolDef[];
    },

    isWriteTool(name: string) {
      return isWriteTool(name);
    },

    async execute(name, args, ctx) {
      return executeToolViaPipeline(name, args, {
        permissionMode: ctx.permissionMode,
        confirmTool: async (info) => {
          const dangerous =
            info.dangerous ||
            (typeof info.args.command === "string" &&
              isDangerousCommand(String(info.args.command)));
          const id = String(
            (ctx as { toolCallId?: string }).toolCallId ?? name,
          );
          ctx.emit({
            type: "tool_pending",
            id,
            name: info.name,
            args: info.args,
            dangerous,
            agent: ctx.agentTag,
          });
          if (!ctx.confirmTool) return false;
          const req: ConfirmToolRequest = {
            id,
            name: info.name,
            args: info.args,
            dangerous,
          };
          return ctx.confirmTool(req);
        },
      });
    },
  };
}
