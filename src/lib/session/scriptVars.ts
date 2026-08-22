/**
 * @file 脚本变量解析与替换
 * @author Charlie
 * @description 从脚本正文提取 `{{name}}` / `{{name|默认值}}` 占位符。
 * 提供按用户输入替换变量，以及单行预览截断工具。
 */

/** 脚本正文中解析出的一个变量 */
export type ScriptVar = {
  name: string;
  defaultValue?: string;
};

const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;

/** 按出现顺序提取去重后的脚本变量列表 */
export function extractScriptVars(body: string): ScriptVar[] {
  const seen = new Set<string>();
  const vars: ScriptVar[] = [];
  for (const match of body.matchAll(VAR_RE)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const rawDefault = match[2]?.trim();
    vars.push({
      name,
      defaultValue: rawDefault || undefined,
    });
  }
  return vars;
}

/**
 * 用给定取值替换脚本中的变量占位符。
 * 优先使用 values；否则回退到模板默认值；都没有则替换为空串。
 */
export function applyScriptVars(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(VAR_RE, (_full, name: string, def?: string) => {
    const v = values[name];
    if (v != null && v !== "") return v;
    if (def != null && def.trim() !== "") return def.trim();
    return "";
  });
}

/** 将脚本正文压成单行并截断，用于列表预览 */
export function previewScriptBody(body: string, max = 72): string {
  const one = body.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}
