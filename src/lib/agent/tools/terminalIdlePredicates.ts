/**
 * @file 终端空闲等待 — 领域谓词（无 session 依赖）
 */

export function normalizeTerminalChunk(text: string): string {
  return text
    .split(/\n/)
    .map((line) => {
      const i = line.lastIndexOf("\r");
      return i >= 0 ? line.slice(i + 1) : line;
    })
    .join("\n");
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const SHELL_PROMPT_RE = new RegExp(
  `(?:^|\\n)(?:${ESC}\\][^${BEL}]*${BEL})*[^\\n]*[@#$%]\\s*$`,
);

export const ERROR_TAIL_RE =
  /(?:dependency failed to start|is unhealthy|Error response from daemon|exit code \d+|✘|(?:^|\n)[^\n]*\berror\b[^\n]*$|(?:^|\n)[^\n]*\bfailed\b[^\n]*$)/im;

export function isShellPrompt(output: string): boolean {
  const tail = output.slice(-2000).trimEnd();
  return Boolean(tail) && SHELL_PROMPT_RE.test(tail);
}

export function likelyTerminalFinished(output: string): boolean {
  if (isShellPrompt(output)) return true;
  const tail = output.slice(-1200);
  return ERROR_TAIL_RE.test(tail) && SHELL_PROMPT_RE.test(output.slice(-400));
}

export function progressDigest(output: string): string {
  const norm = normalizeTerminalChunk(output);
  const slice = norm.slice(-1200);
  let h = 2166136261;
  for (let i = 0; i < slice.length; i++) {
    h ^= slice.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `d${(h >>> 0).toString(16)}:${slice.length}`;
}
