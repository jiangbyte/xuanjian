/**
 * @file SSH 目标解析与主机匹配
 * @author Charlie
 * @description 解析 `ssh user@host`、`-p` 端口等常见写法为结构化目标。
 * 并在主机列表中按目标或自由文本查询进行匹配。
 */

/** 解析后的 SSH 连接目标 */
export type SshTarget = {
  username: string;
  host: string;
  port: number;
};

/**
 * 解析 `ssh user@host`、`user@host:22`、`ssh -p 2222 user@host` 等。
 * 纯关键字搜索（无 ssh / 用户 / 端口）不会当作连接目标。
 */
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

  // 去掉暂未处理的其它常见短选项
  s = s.replace(/(?:^|\s)-[A-Za-z]\S*/g, " ").trim();
  if (!s) return null;

  const m = s.match(/^(?:([^@\s]+)@)?([A-Za-z0-9._\-[\]]+)(?::(\d+))?$/);
  if (!m?.[2]) return null;

  const hasUser = Boolean(m[1]);
  const hasPort = Boolean(m[3]) || Boolean(portFlag);
  // 纯关键字搜索不应变成连接目标
  if (!hadSsh && !hasUser && !hasPort) return null;

  return {
    username: m[1] || "root",
    host: m[2],
    port: m[3] ? Number(m[3]) : port,
  };
}

/**
 * 在主机列表中查找与目标最匹配的一项。
 * 优先：主机+用户+端口 → 主机+用户 → 仅主机。
 */
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

/**
 * 判断主机是否命中搜索词。
 * 若已解析出 SshTarget，优先按主机/用户匹配；否则对名称、标签等字段做子串匹配。
 */
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

  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part));
}
