/**
 * @file 终端 ANSI 清洗（Observation / 摘要用）
 * @author Charlie
 */

/** ESC / BEL：用构造函数拼正则，避免字面量中的控制字符触发 lint */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const OTHER_ESC_RE = new RegExp(`${ESC}[@-Z\\\\-_]`, "g");

/** 去掉 CSI / OSC 等常见 ANSI，便于侧栏阅读与喂给模型。 */
export function stripAnsi(input: string): string {
  return input
    .replace(OSC_RE, "")
    .replace(CSI_RE, "")
    .replace(OTHER_ESC_RE, "")
    .replace(/\r/g, "");
}
