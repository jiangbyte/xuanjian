/**
 * @file 已知 SSH 主机指纹
 * @author Charlie
 * @description known_hosts 表 CRUD；与后端 SSH 主机密钥校验共用。
 */

import { getDb } from "@/lib/db/client";

export type KnownHostRow = {
  id: number;
  host: string;
  port: number;
  fingerprint: string;
};

export async function listKnownHosts(): Promise<KnownHostRow[]> {
  const db = await getDb();
  return db.select<KnownHostRow[]>(
    "SELECT id, host, port, fingerprint FROM known_hosts ORDER BY host, port",
  );
}

export async function addKnownHost(
  host: string,
  port: number,
  fingerprint: string,
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO known_hosts (host, port, fingerprint) VALUES ($1, $2, $3)
     ON CONFLICT(host, port) DO UPDATE SET fingerprint = excluded.fingerprint`,
    [host.trim(), port, fingerprint.trim()],
  );
  return result.lastInsertId as number;
}

export async function removeKnownHost(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM known_hosts WHERE id = $1", [id]);
}

export async function getKnownHostFingerprint(
  host: string,
  port: number,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ fingerprint: string }[]>(
    "SELECT fingerprint FROM known_hosts WHERE host = $1 AND port = $2 LIMIT 1",
    [host.trim(), port],
  );
  return rows[0]?.fingerprint ?? null;
}
