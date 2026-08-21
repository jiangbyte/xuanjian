export type ScriptVar = {
  name: string;
  defaultValue?: string;
};

const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;

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

export function previewScriptBody(body: string, max = 72): string {
  const one = body.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}
