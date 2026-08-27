/**
 * @file 计划模式：从回复拆分可执行步骤
 */

const PLAN_SECTION_RE =
  /(?:^|\n)#+\s*(?:执行计划|建议操作|待执行步骤|操作步骤|后续步骤|清理步骤|执行步骤)(?:[（(][^）)\n]*[）)])?\s*\n([\s\S]*?)(?=\n#+\s[^#]|\n---\s*\n|$)/i;

const LIST_ITEM_RE = /^(\d+[\.\)、]|[*•-])\s+/;

const FINDING_HINTS =
  /(?:非常健康|无需|正常|为空|占比|可用空间|保持现状|收益有限|无.*(?:堆积|膨胀|告警)|属写操作|计划模式下未执行|\d+(?:\.\d+)?\s*(?:MiB|GiB|KiB|MB|GB|KB)\b|^\s*\/?[\w./-]+\s+\d+(?:\.\d+)?\s*(?:MiB|GiB|KiB))/i;

const ACTION_HINTS =
  /(?:执行|运行|清理|删除|安装|部署|同步|重启|停止|启动|升级|备份|恢复|配置|修改|创建|移除|卸载|拉取|构建|发布|回滚|扩容|缩容|apt\s+(?:clean|install|update|upgrade|remove)|yum\s+|dnf\s+|docker\s+(?:run|pull|push|compose|exec|rm)|kubectl\s+|systemctl\s+|chmod\s+|chown\s+|rm\s+-|mv\s+|cp\s+|sync_to_remote|terminal_run|run_script|write_remote_file|deploy\b|upload_)/i;

function stripListMarker(line: string): string {
  return line.replace(LIST_ITEM_RE, "").trim();
}

function extractListItems(block: string): string[] {
  return block
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => LIST_ITEM_RE.test(l))
    .map(stripListMarker)
    .filter(Boolean);
}

function isActionablePlanLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 6) return false;
  if (FINDING_HINTS.test(t)) return false;
  return ACTION_HINTS.test(t);
}

/** 从回复中拆分正文与可执行计划（计划模式专用） */
export function splitPlanFromReply(text: string): {
  body: string;
  planItems: string[] | null;
} {
  const trimmed = text.trim();
  if (!trimmed) return { body: "", planItems: null };

  const sectionMatch = trimmed.match(PLAN_SECTION_RE);
  if (sectionMatch?.index != null) {
    const planItems = extractListItems(sectionMatch[1]).filter(
      isActionablePlanLine,
    );
    const body = (
      trimmed.slice(0, sectionMatch.index) +
      trimmed.slice(sectionMatch.index + sectionMatch[0].length)
    )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      body: body || trimmed,
      planItems: planItems.length ? planItems : null,
    };
  }

  const actionable = extractListItems(trimmed).filter(isActionablePlanLine);
  return {
    body: trimmed,
    planItems: actionable.length ? actionable : null,
  };
}

/** 一键执行计划时发给 Agent 的用户消息 */
export function buildPlanExecutePrompt(items: string[]): string {
  const steps = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
  return `请按以下执行计划逐步执行（用户已切换为确认执行模式并授权执行）。需要写操作或终端命令时按流程执行；每步完成后简要汇报，全部完成后给出总结。

${steps}`;
}
