/**
 * @file IPv4 CIDR / 子网计算工具
 * @author Charlie
 * @description 为网络工具面板提供 CIDR 解析、掩码换算、归属判断与子网划分。
 * 另附常用端口表，供端口探测面板快速填充。
 */

/** CIDR 计算结果 */
export type IpCalcResult = {
  cidr: string;
  network: string;
  broadcast: string;
  mask: string;
  wildcard: string;
  prefix: number;
  firstHost: string;
  lastHost: string;
  hostCount: number;
  error?: string;
};

/** 划分子网后的一行结果 */
export type SubnetRow = {
  index: number;
  cidr: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  hostCount: number;
};

// —— 内部：IP 与整数互转 ——

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(
    ".",
  );
}

function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/** 点分掩码转前缀长度；非连续 1 位掩码返回 null */
export function maskToPrefix(mask: string): number | null {
  const n = ipToInt(mask);
  if (n == null) return null;
  let bits = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = (n >>> i) & 1;
    if (bit === 1) {
      if (seenZero) return null;
      bits += 1;
    } else {
      seenZero = true;
    }
  }
  return bits;
}

/**
 * 解析 `a.b.c.d/prefix` 或裸 IP（默认 /32）。
 * 非法输入返回 null。
 */
export function parseCidr(
  input: string,
): { ip: number; prefix: number } | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.includes("/")) {
    const [ipPart, prefPart] = raw.split("/");
    const ip = ipToInt(ipPart);
    const prefix = Number(prefPart);
    if (ip == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return null;
    }
    return { ip, prefix };
  }
  const ip = ipToInt(raw);
  if (ip == null) return null;
  return { ip, prefix: 32 };
}

/**
 * 计算 CIDR 网段信息；可选 maskHint 在输入无前缀时补全。
 * 失败时各字段为 "—" 并带 error。
 */
export function calcCidr(input: string, maskHint?: string): IpCalcResult {
  let parsed = parseCidr(input);
  if (!parsed && maskHint) {
    const ip = ipToInt(input.trim());
    const prefix = maskToPrefix(maskHint);
    if (ip != null && prefix != null) parsed = { ip, prefix };
  }
  if (!parsed) {
    return {
      cidr: input,
      network: "—",
      broadcast: "—",
      mask: "—",
      wildcard: "—",
      prefix: 0,
      firstHost: "—",
      lastHost: "—",
      hostCount: 0,
      error: "invalid CIDR",
    };
  }
  const { ip, prefix } = parsed;
  const mask = prefixToMask(prefix);
  const network = (ip & mask) >>> 0;
  const wildcard = ~mask >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const hostCount =
    prefix >= 31
      ? prefix === 32
        ? 1
        : 2
      : Math.max(0, broadcast - network - 1);
  const firstHost = prefix >= 31 ? intToIp(network) : intToIp(network + 1);
  const lastHost = prefix >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1);
  return {
    cidr: `${intToIp(network)}/${prefix}`,
    network: intToIp(network),
    broadcast: intToIp(broadcast),
    mask: intToIp(mask),
    wildcard: intToIp(wildcard),
    prefix,
    firstHost,
    lastHost,
    hostCount,
  };
}

/** 判断 IP 是否落在给定 CIDR 内；参数非法返回 null */
export function ipInNetwork(ipStr: string, cidr: string): boolean | null {
  const ip = ipToInt(ipStr);
  const net = parseCidr(cidr);
  if (ip == null || !net) return null;
  const mask = prefixToMask(net.prefix);
  return (ip & mask) >>> 0 === (net.ip & mask) >>> 0;
}

/** 将网段均分为 count 个子网（向上取 2 的幂） */
export function splitSubnets(cidr: string, count: number): SubnetRow[] {
  const net = parseCidr(cidr);
  if (!net || count < 1) return [];
  const neededBits = Math.ceil(Math.log2(count));
  const newPrefix = net.prefix + neededBits;
  if (newPrefix > 32) return [];
  const size = 2 ** (32 - newPrefix);
  const base = (net.ip & prefixToMask(net.prefix)) >>> 0;
  const rows: SubnetRow[] = [];
  for (let i = 0; i < 2 ** neededBits && rows.length < count; i++) {
    const network = (base + i * size) >>> 0;
    const broadcast = (network + size - 1) >>> 0;
    const hostCount =
      newPrefix >= 31 ? (newPrefix === 32 ? 1 : 2) : Math.max(0, size - 2);
    rows.push({
      index: i + 1,
      cidr: `${intToIp(network)}/${newPrefix}`,
      network: intToIp(network),
      broadcast: intToIp(broadcast),
      firstHost: newPrefix >= 31 ? intToIp(network) : intToIp(network + 1),
      lastHost: newPrefix >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1),
      hostCount,
    });
  }
  return rows;
}

/** 按每子网至少 hostsPer 个可用主机数进行划分 */
export function allocateByHosts(cidr: string, hostsPer: number): SubnetRow[] {
  if (hostsPer < 1) return [];
  const need = hostsPer + 2; // 网络地址 + 广播地址
  const hostBits = Math.ceil(Math.log2(Math.max(need, 2)));
  const net = parseCidr(cidr);
  if (!net) return [];
  const newPrefix = 32 - hostBits;
  if (newPrefix < net.prefix) return [];
  const count = 2 ** (newPrefix - net.prefix);
  return splitSubnets(`${calcCidr(cidr).network}/${net.prefix}`, count);
}

/** 常用服务端口快捷列表 */
export const COMMON_PORTS: { port: number; name: string }[] = [
  { port: 22, name: "SSH" },
  { port: 80, name: "HTTP" },
  { port: 443, name: "HTTPS" },
  { port: 21, name: "FTP" },
  { port: 25, name: "SMTP" },
  { port: 53, name: "DNS" },
  { port: 110, name: "POP3" },
  { port: 143, name: "IMAP" },
  { port: 3306, name: "MySQL" },
  { port: 5432, name: "PostgreSQL" },
  { port: 6379, name: "Redis" },
  { port: 8080, name: "HTTP-Alt" },
  { port: 8443, name: "HTTPS-Alt" },
  { port: 3389, name: "RDP" },
  { port: 445, name: "SMB" },
];
