/**
 * @file compaction 模块导出
 * @author Charlie
 */

export {
  registerCompactionHook,
  resetCompactionHook,
  setCompactionRuntime,
  compactOnOverflow,
} from "@/lib/agent/compaction/basic";
export {
  checkContextPressure,
  isContextOverflowError,
} from "@/lib/agent/compaction/pressure";
export {
  applyCompactionToMessages,
  summarizeForCompaction,
  compactIfNeeded,
} from "@/lib/agent/compaction/summarize";
export { selectCompactableRange } from "@/lib/agent/compaction/region";
export {
  sanitizeLlmMessagesForApi,
  isToolPairingBalancedBefore,
} from "@/lib/agent/compaction/tool-pairing";
export { pruneOldToolResults } from "@/lib/agent/compaction/prune";
export { compactLlmMessagesForModel } from "@/lib/agent/compaction/truncate";
