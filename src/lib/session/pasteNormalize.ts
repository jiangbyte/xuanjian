/**
 * @file 终端粘贴文本规范化
 * @description Windows 剪贴板多为 CRLF。若把 `\r\n` 原样写入 Linux PTY，
 * 行尾 `\` 只转义 `\r`，随后的 `\n` 仍会结束命令，导致多行 docker run 等被拆成多条命令。
 */

/** 将粘贴/投递文本规范为 LF，供 bash 行续接 `\` 正常工作。 */
export function normalizePasteForPty(text: string): string {
  if (!text) return text;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
