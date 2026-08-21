/**
 * @file 连通性可视化类型与状态归约
 * @author Charlie
 */

export type PingSample = {
  seq: number;
  rttMs: number | null;
  at: number;
};

export type PingSummary = {
  minMs?: number;
  avgMs?: number;
  maxMs?: number;
  lossPct?: number;
  sent?: number;
  recv?: number;
};

export type TraceHop = {
  hop: number;
  host?: string;
  ip?: string;
  rtts: (number | null)[];
};

export const PING_SAMPLE_CAP = 300;

export function derivePingStats(samples: PingSample[], summary: PingSummary | null) {
  const ok = samples.filter((s) => s.rttMs != null).map((s) => s.rttMs as number);
  const lost = samples.filter((s) => s.rttMs == null).length;
  const fromSamples =
    ok.length > 0
      ? {
          minMs: Math.min(...ok),
          avgMs: ok.reduce((a, b) => a + b, 0) / ok.length,
          maxMs: Math.max(...ok),
          lossPct: samples.length ? (lost / samples.length) * 100 : 0,
          sent: samples.length,
          recv: ok.length,
        }
      : null;

  return {
    minMs: summary?.minMs ?? fromSamples?.minMs,
    avgMs: summary?.avgMs ?? fromSamples?.avgMs,
    maxMs: summary?.maxMs ?? fromSamples?.maxMs,
    lossPct: summary?.lossPct ?? fromSamples?.lossPct,
    sent: summary?.sent ?? fromSamples?.sent,
    recv: summary?.recv ?? fromSamples?.recv,
  };
}

export function pushPingSample(
  prev: PingSample[],
  sample: PingSample,
): PingSample[] {
  const next = [...prev, sample];
  if (next.length <= PING_SAMPLE_CAP) return next;
  return next.slice(next.length - PING_SAMPLE_CAP);
}

export function upsertTraceHop(prev: TraceHop[], hop: TraceHop): TraceHop[] {
  const i = prev.findIndex((h) => h.hop === hop.hop);
  if (i < 0) return [...prev, hop].sort((a, b) => a.hop - b.hop);
  const copy = [...prev];
  copy[i] = hop;
  return copy;
}
