/**
 * @file SFTP 双栏传输相关类型
 * @author Charlie
 * @description 定义左右侧面板、标签页与端点快照的共享类型。
 */

import type { SftpEntry } from "@/lib/tauri";

/** 传输面板左右侧 */
export type Side = "left" | "right";

/** 单侧标签：本地文件系统或远程主机 */
export type PaneTab = {
  id: string;
  kind: "local" | "host";
  hostId?: number;
  label: string;
};

/** 传输源/目标端点（工作目录 + 会话） */
export type SideEndpoint = {
  cwd: string;
  sessionId: string | null;
  remote: boolean;
};

/** 单侧运行时快照，供跨栏传输读取 */
export type SideSnapshot = SideEndpoint & {
  selected: SftpEntry | null;
  checked: SftpEntry[];
  ready: boolean;
  reload: () => Promise<void>;
};
