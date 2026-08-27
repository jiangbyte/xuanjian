/**
 * @file 计划模式回复拆分测试
 */

import { describe, expect, it } from "vitest";
import {
  splitPlanFromReply,
  buildPlanExecutePrompt,
} from "@xuanjian/agent-core";

describe("splitPlanFromReply", () => {
  it("ignores diagnostic bullets when no actionable steps", () => {
    const text = `建议：当前无需任何磁盘清理动作，保持现状即可。

1. **磁盘非常健康**：根分区仅 5% 用量，46.6 GiB 可用
2. **无大文件堆积**：/data、/opt 为空
3. **日志无膨胀**：一切正常
4. **唯一可留意项（非必要）**：/var/lib/apt/lists 缓存约 94 MiB（属写操作，计划模式下未执行，且收益有限）`;

    const { body, planItems } = splitPlanFromReply(text);
    expect(body).toBe(text);
    expect(planItems).toBeNull();
  });

  it("extracts only actionable items from ## 执行计划 section", () => {
    const text = `根分区空间充足，暂无告警。

## 执行计划
1. 在目标主机执行 \`sudo apt clean\` 清理 apt 缓存
2. 磁盘非常健康，无需其他操作
3. 使用 sync_to_remote 将构建产物同步到远程`;

    const { body, planItems } = splitPlanFromReply(text);
    expect(body).not.toContain("## 执行计划");
    expect(planItems).toEqual([
      "在目标主机执行 `sudo apt clean` 清理 apt 缓存",
      "使用 sync_to_remote 将构建产物同步到远程",
    ]);
  });

  it("does not treat file size listings as plan items", () => {
    const text = `- /var/lib/apt/lists/deb.debian.org_debian_dists_trixie_main_binary-amd64_Packages 23.9 MiB
- /boot/initrd.img-6.12.95+deb13-amd64 56.5 MiB`;

    expect(splitPlanFromReply(text).planItems).toBeNull();
  });
});

describe("buildPlanExecutePrompt", () => {
  it("builds execute prompt for confirm mode handoff", () => {
    const prompt = buildPlanExecutePrompt([
      "在目标主机执行 `sudo apt clean`",
      "使用 sync_to_remote 同步产物",
    ]);
    expect(prompt).toContain("确认执行模式");
    expect(prompt).toContain("sudo apt clean");
    expect(prompt).toContain("2. 使用 sync_to_remote");
  });
});
