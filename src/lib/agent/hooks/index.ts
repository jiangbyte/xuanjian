/**
 * @file hooks 模块导出
 * @author Charlie
 */

export {
  clearAllHooks,
  runPostExecuteHooks,
  runPreExecuteHooks,
  runPreRequestHooks,
  runPreStepHooks,
  registerHook,
} from "@/lib/agent/hooks/registry";
export type {
  HookPoint,
  PostExecuteContext,
  PreExecuteContext,
  PreExecuteDecision,
  PreRequestContext,
  PreStepContext,
  PreStepDecision,
} from "@/lib/agent/hooks/registry";
export {
  registerDefaultToolHooks,
  resetDefaultToolHooks,
} from "@/lib/agent/hooks/defaultTools";
