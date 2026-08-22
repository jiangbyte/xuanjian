/**
 * @file Docker CLI 辅助（Agent 工具复用）
 * @author Charlie
 */

export const DOCKER_JSON_FORMAT = `--format "{{json .}}"`;

export function parseDockerJsonLines<T>(raw: string): T[] {
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

export function looksLikeDockerError(raw: string) {
  return /Cannot connect to the Docker daemon|Is the docker daemon running|docker: command not found|is not recognized as an internal or external command|permission denied while trying to connect|error during connect/i.test(
    raw,
  );
}

export function safeDockerArg(value: string): string {
  const v = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-/:]*$/.test(v)) {
    throw new Error(`unsafe docker ref: ${value}`);
  }
  return v;
}
