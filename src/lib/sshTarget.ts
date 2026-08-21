export type SshTarget = {
  username: string;
  host: string;
  port: number;
};

/** Parse `ssh user@host`, `user@host:22`, `ssh -p 2222 user@host`. */
export function parseSshTarget(raw: string): SshTarget | null {
  let s = raw.trim();
  if (!s) return null;

  const hadSsh = /^ssh\b/i.test(s);
  s = s.replace(/^ssh\s+/i, "").trim();

  let port = 22;
  const portFlag = s.match(/(?:^|\s)-p\s*(\d+)\b/i);
  if (portFlag) {
    port = Number(portFlag[1]) || 22;
    s = s.replace(/(?:^|\s)-p\s*\d+\b/i, " ").trim();
  }

  // drop other common flags we don't handle yet
  s = s.replace(/(?:^|\s)-[A-Za-z]\S*/g, " ").trim();
  if (!s) return null;

  const m = s.match(/^(?:([^@\s]+)@)?([A-Za-z0-9._\-[\]]+)(?::(\d+))?$/);
  if (!m?.[2]) return null;

  const hasUser = Boolean(m[1]);
  const hasPort = Boolean(m[3]) || Boolean(portFlag);
  // Plain keyword search should not become a connect target
  if (!hadSsh && !hasUser && !hasPort) return null;

  return {
    username: m[1] || "root",
    host: m[2],
    port: m[3] ? Number(m[3]) : port,
  };
}

export function findHostByTarget<
  T extends { host: string; username: string; port: number },
>(hosts: T[], target: SshTarget): T | null {
  const hostEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const userEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  return (
    hosts.find(
      (h) =>
        hostEq(h.host, target.host) &&
        userEq(h.username, target.username) &&
        h.port === target.port,
    ) ||
    hosts.find(
      (h) => hostEq(h.host, target.host) && userEq(h.username, target.username),
    ) ||
    hosts.find((h) => hostEq(h.host, target.host)) ||
    null
  );
}

export function hostMatchesQuery(
  host: {
    name: string;
    host: string;
    port: number;
    username: string;
    tags?: string;
    remark?: string | null;
    group_name?: string | null;
  },
  query: string,
  target: SshTarget | null,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (target) {
    const hostHit = host.host.toLowerCase().includes(target.host.toLowerCase());
    const userHit =
      !target.username ||
      host.username.toLowerCase().includes(target.username.toLowerCase());
    if (hostHit && userHit) return true;
  }

  const hay = [
    host.name,
    host.host,
    host.username,
    `${host.username}@${host.host}`,
    `${host.username}@${host.host}:${host.port}`,
    String(host.port),
    host.tags || "",
    host.remark || "",
    host.group_name || "",
  ]
    .join(" ")
    .toLowerCase();

  return q.split(/\s+/).filter(Boolean).every((part) => hay.includes(part));
}
