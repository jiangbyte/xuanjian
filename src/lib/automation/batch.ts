/**
 * @file 批量脚本执行
 * @author Charlie
 * @description 在多台主机上并发执行脚本（默认并发上限 5）。
 */

import { getScript, listHosts, type HostRow } from "@/lib/db";
import { connectSshHost } from "@/lib/session/connect";
import { applyScriptVars } from "@/lib/session/scriptVars";
import { api } from "@/lib/tauri";

export type BatchHostResult = {
  host_id: number;
  host_name: string;
  ok: boolean;
  output?: string;
  error?: string;
};

export type BatchRunResult = {
  script_id: number;
  script_name: string;
  results: BatchHostResult[];
};

const DEFAULT_CONCURRENCY = 5;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function resolveBatchHostIds(input: {
  host_ids?: number[];
  host_group_id?: number | null;
}): Promise<number[]> {
  if (input.host_ids?.length) {
    return [...new Set(input.host_ids)];
  }
  if (input.host_group_id != null) {
    const hosts = await listHosts();
    return hosts
      .filter((h) => h.group_id === input.host_group_id)
      .map((h) => h.id);
  }
  return [];
}

async function runOnHost(
  host: HostRow,
  command: string,
): Promise<BatchHostResult> {
  try {
    const { session } = await connectSshHost(host.id, { runStartup: false });
    try {
      const out = await api.sessionExec(session.id, command);
      return {
        host_id: host.id,
        host_name: host.name,
        ok: true,
        output: out.slice(0, 16_000),
      };
    } finally {
      await api.sessionClose(session.id).catch(() => undefined);
    }
  } catch (e) {
    return {
      host_id: host.id,
      host_name: host.name,
      ok: false,
      error: String(e),
    };
  }
}

/**
 * 在多台主机上执行脚本库脚本。
 */
export async function runBatchScript(opts: {
  script_id: number;
  host_ids?: number[];
  host_group_id?: number | null;
  vars?: Record<string, string>;
  concurrency?: number;
}): Promise<BatchRunResult> {
  const script = await getScript(opts.script_id);
  if (!script) throw new Error(`Script #${opts.script_id} not found`);

  const hostIds = await resolveBatchHostIds(opts);
  if (!hostIds.length) throw new Error("No target hosts");

  const allHosts = await listHosts();
  const hostMap = new Map(allHosts.map((h) => [h.id, h]));
  const targets = hostIds
    .map((id) => hostMap.get(id))
    .filter((h): h is HostRow => h != null);
  if (!targets.length) throw new Error("No matching hosts");

  const body = applyScriptVars(script.body, opts.vars ?? {});
  const command = body.replace(/\r\n/g, "\n").trim();
  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY),
  );

  const results = await mapPool(targets, concurrency, (host) =>
    runOnHost(host, command),
  );

  return {
    script_id: script.id,
    script_name: script.name,
    results,
  };
}

/** 批量执行原始命令（Agent run_batch 等场景） */
export async function runBatchCommand(opts: {
  command: string;
  host_ids?: number[];
  host_group_id?: number | null;
  concurrency?: number;
}): Promise<{ results: BatchHostResult[] }> {
  const hostIds = await resolveBatchHostIds(opts);
  if (!hostIds.length) throw new Error("No target hosts");
  const allHosts = await listHosts();
  const hostMap = new Map(allHosts.map((h) => [h.id, h]));
  const targets = hostIds
    .map((id) => hostMap.get(id))
    .filter((h): h is HostRow => h != null);
  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY),
  );
  const results = await mapPool(targets, concurrency, (host) =>
    runOnHost(host, opts.command),
  );
  return { results };
}
