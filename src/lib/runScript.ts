import { api } from "./tauri";
import type { ScriptRow } from "./db";
import { applyScriptVars, extractScriptVars } from "./scriptVars";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type ScriptPromptFn = (
  label: string,
  def?: string,
) => Promise<string | null> | string | null;

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

export async function sendScriptToSession(
  sessionId: string,
  body: string,
  opts: { pasteOnly: boolean; sendMode: "once" | "line" },
) {
  const text = body.replace(/\r\n/g, "\n");
  if (opts.sendMode === "line") {
    const lines = text.split("\n");
    for (const line of lines) {
      await api.sessionWrite(
        sessionId,
        opts.pasteOnly ? line : `${line}\n`,
      );
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
    const { useCmdHistory } = await import("../stores/cmdHistory");
    useCmdHistory.getState().push({
      cmd: body.split("\n")[0] || script.name,
      sessionId,
      label: script.name,
    });
  } catch {
    /* ignore */
  }
  return true;
}
