/**
 * @file 进程树：解析 PPID、构建树、过滤
 */

export type ProcFlat = {
  pid: string;
  ppid: string;
  user: string;
  cpu: number;
  mem: number;
  cmd: string;
};

export type ProcTreeNode = ProcFlat & {
  children: ProcTreeNode[];
};

/** 解析含 PPID 的 ps 输出 */
export function parsePsWithPpid(raw: string): ProcFlat[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ProcFlat[] = [];
  for (const line of lines) {
    if (/^PID\b/i.test(line)) continue;
    const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    out.push({
      pid: m[1],
      ppid: m[2],
      user: m[3],
      cpu: Number(m[4]) || 0,
      mem: Number(m[5]) || 0,
      cmd: m[6],
    });
  }
  return out;
}

/** 由扁平列表构建进程树（孤儿节点挂到根） */
export function buildProcTree(procs: ProcFlat[]): ProcTreeNode[] {
  const byPid = new Map<string, ProcTreeNode>();
  for (const p of procs) {
    byPid.set(p.pid, { ...p, children: [] });
  }
  const roots: ProcTreeNode[] = [];
  for (const node of byPid.values()) {
    const parent =
      node.ppid !== node.pid && node.ppid !== "0"
        ? byPid.get(node.ppid)
        : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: ProcTreeNode[]) => {
    nodes.sort((a, b) => Number(a.pid) - Number(b.pid));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

export function shortProcName(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) return "?";
  if (trimmed.startsWith("[")) {
    const bracket = trimmed.match(/^\[[^\]]+\]/);
    return bracket ? bracket[0] : trimmed.slice(0, 28);
  }
  const token = trimmed.split(/\s+/)[0] || trimmed;
  const base = token.split("/").pop() || token;
  return base.replace(/:$/, "") || trimmed.slice(0, 28);
}

/** 搜索匹配时保留命中节点及其祖先/后代 */
export function filterProcTree(
  roots: ProcTreeNode[],
  query: string,
): ProcTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return roots;

  function matches(node: ProcTreeNode): boolean {
    return (
      node.pid.includes(q) ||
      node.user.toLowerCase().includes(q) ||
      node.cmd.toLowerCase().includes(q) ||
      shortProcName(node.cmd).toLowerCase().includes(q)
    );
  }

  function walk(node: ProcTreeNode): ProcTreeNode | null {
    const kids = node.children
      .map(walk)
      .filter((n): n is ProcTreeNode => n != null);
    if (matches(node) || kids.length > 0) {
      return { ...node, children: kids };
    }
    return null;
  }

  return roots.map(walk).filter((n): n is ProcTreeNode => n != null);
}

/** 默认折叠深度 >= 2 的有子节点 */
export function defaultCollapsedPids(
  roots: ProcTreeNode[],
  maxDepth = 1,
): Set<string> {
  const collapsed = new Set<string>();
  const walk = (nodes: ProcTreeNode[], depth: number) => {
    for (const n of nodes) {
      if (depth >= maxDepth && n.children.length > 0) collapsed.add(n.pid);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return collapsed;
}

export function countProcTree(nodes: ProcTreeNode[]): number {
  let n = 0;
  const walk = (list: ProcTreeNode[]) => {
    for (const node of list) {
      n += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return n;
}
