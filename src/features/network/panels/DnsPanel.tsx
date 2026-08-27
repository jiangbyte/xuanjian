/**
 * @file DNS 解析面板
 */

import { DnsPage } from "./connectivity/DnsPage";

/** 独立 DNS 解析入口 */
export function DnsPanel() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-4">
      <DnsPage />
    </div>
  );
}
