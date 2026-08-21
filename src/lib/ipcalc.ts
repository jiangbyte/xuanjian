/** IPv4 CIDR / subnet helpers for the network tools panel. */

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

export type SubnetRow = {
  index: number;
  cidr: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  hostCount: number;
};

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
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ].join(".");
}

function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

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

export function parseCidr(input: string): { ip: number; prefix: number } | null {
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
  const wildcard = (~mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const hostCount =
    prefix >= 31 ? (prefix === 32 ? 1 : 2) : Math.max(0, broadcast - network - 1);
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

export function ipInNetwork(ipStr: string, cidr: string): boolean | null {
  const ip = ipToInt(ipStr);
  const net = parseCidr(cidr);
  if (ip == null || !net) return null;
  const mask = prefixToMask(net.prefix);
  return (ip & mask) >>> 0 === (net.ip & mask) >>> 0;
}

/** Split a network into `count` equal subnets (next power-of-two). */
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
      newPrefix >= 31
        ? newPrefix === 32
          ? 1
          : 2
        : Math.max(0, size - 2);
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

/** Allocate subnets with at least `hostsPer` usable hosts each. */
export function allocateByHosts(cidr: string, hostsPer: number): SubnetRow[] {
  if (hostsPer < 1) return [];
  const need = hostsPer + 2; // network + broadcast
  const hostBits = Math.ceil(Math.log2(Math.max(need, 2)));
  const net = parseCidr(cidr);
  if (!net) return [];
  const newPrefix = 32 - hostBits;
  if (newPrefix < net.prefix) return [];
  const count = 2 ** (newPrefix - net.prefix);
  return splitSubnets(`${calcCidr(cidr).network}/${net.prefix}`, count);
}

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
