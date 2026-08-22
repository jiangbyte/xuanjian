/**
 * @file 终端 ANSI 清洗（Observation / 摘要用）
 * @author Charlie
 */

/** 去掉 CSI / OSC 等常见 ANSI，便于侧栏阅读与喂给模型。 */
export function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/\r/g, "");
}
