/**
 * @file 脚本向会话投递与执行
 * @author Charlie
 * @description 解析脚本变量后，将正文写入本地或 SSH 会话。
 * 支持整段粘贴或按行发送，并可选记入命令历史。
 */

import { api } from "@/lib/tauri";
import type { ScriptRow } from "@/lib/db";
import { applyScriptVars, extractScriptVars } from "@/lib/scriptVars";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 向用户询问单个脚本变量取值的回调 */
export type ScriptPromptFn = (
  label: string,
  def?: string,
) => Promise<string | null> | string | null;

/**
 * 依次提示变量取值并替换进脚本正文。
 * 用户取消任一提示时返回 null。
 */
export async function resolveScriptBody(
  script: Pick<ScriptRow, "body" | "name">,
  promptFn: ScriptPromptFn,
): Promise<string | null> {
  const vars = extractScriptVars(script.body);
  const values: Record<string, string> = {};
  for (const v of vars) {
    const answered = await promptFn(
      `${script.name} · ${v.name}`,
      v.defaultValue ?? "",
    );
    if (answered == null) return null;
    values[v.name] = answered;
  }
  return applyScriptVars(script.body, values);
}

/**
 * 将已解析正文写入指定会话。
 * pasteOnly 为真时不追加换行；sendMode 为 line 时按行间隔发送。
 */
export async function sendScriptToSession(
  sessionId: string,
  body: string,
  opts: { pasteOnly: boolean; sendMode: "once" | "line" },
) {
  const text = body.replace(/\r\n/g, "\n");
  if (opts.sendMode === "line") {
    const lines = text.split("\n");
    for (const line of lines) {
      await api.sessionWrite(sessionId, opts.pasteOnly ? line : `${line}\n`);
      await sleep(60);
    }
    return;
  }
  if (opts.pasteOnly) {
    await api.sessionWrite(sessionId, text);
  } else {
    await api.sessionWrite(sessionId, text.endsWith("\n") ? text : `${text}\n`);
  }
}

/**
 * 在会话上完整跑一遍脚本：解析变量 → 写入会话 → 记入命令历史。
 * 取消变量输入时返回 false。
 */
export async function runScriptOnSession(
  sessionId: string,
  script: ScriptRow,
  promptFn: ScriptPromptFn,
) {
  const body = await resolveScriptBody(script, promptFn);
  if (body == null) return false;
  await sendScriptToSession(sessionId, body, {
    pasteOnly: Boolean(script.paste_only),
    sendMode: script.send_mode === "line" ? "line" : "once",
  });
  try {
    const { useCmdHistory } = await import("@/stores/cmdHistory");
    useCmdHistory.getState().push({
      cmd: body.split("\n")[0] || script.name,
      sessionId,
      label: script.name,
    });
  } catch {
    /* 忽略历史写入失败 */
  }
  return true;
}
