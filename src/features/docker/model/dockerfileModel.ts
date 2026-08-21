/**
 * @file Dockerfile 指令模型
 * @author Charlie
 * @description 常用指令解析 / 序列化，支持多阶段 FROM。
 */

export type DockerfileInstruction =
  | { id: string; kind: "FROM"; image: string; as?: string; platform?: string }
  | { id: string; kind: "ARG"; name: string; defaultValue?: string }
  | { id: string; kind: "ENV"; pairs: { key: string; value: string }[] }
  | { id: string; kind: "WORKDIR"; path: string }
  | {
      id: string;
      kind: "COPY";
      src: string;
      dest: string;
      from?: string;
      chown?: string;
    }
  | { id: string; kind: "ADD"; src: string; dest: string }
  | { id: string; kind: "RUN"; command: string }
  | { id: string; kind: "EXPOSE"; ports: string[] }
  | { id: string; kind: "USER"; user: string }
  | { id: string; kind: "VOLUME"; paths: string[] }
  | { id: string; kind: "LABEL"; pairs: { key: string; value: string }[] }
  | { id: string; kind: "HEALTHCHECK"; args: string }
  | { id: string; kind: "SHELL"; form: string[] }
  | { id: string; kind: "CMD"; form: "exec" | "shell"; value: string }
  | { id: string; kind: "ENTRYPOINT"; form: "exec" | "shell"; value: string }
  | { id: string; kind: "COMMENT"; text: string }
  | { id: string; kind: "RAW"; text: string };

let _seq = 0;
function nid(): string {
  _seq += 1;
  return `i${Date.now().toString(36)}_${_seq}`;
}

/** 新建指令 id */
export function newInstructionId(): string {
  return nid();
}

function splitShellWords(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: "'" | '"' | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function parseJsonArray(s: string): string[] | null {
  const t = s.trim();
  if (!t.startsWith("[")) return null;
  try {
    const v = JSON.parse(t.replace(/'/g, '"'));
    if (Array.isArray(v)) return v.map(String);
  } catch {
    /* fallthrough */
  }
  return null;
}

/** 源码 → 指令列表 */
export function parseDockerfile(text: string): DockerfileInstruction[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const logical: string[] = [];
  let buf = "";
  for (const line of lines) {
    const trimmedRight = line.replace(/\s+$/, "");
    if (trimmedRight.endsWith("\\")) {
      buf += `${trimmedRight.slice(0, -1)} `;
      continue;
    }
    logical.push(buf + line);
    buf = "";
  }
  if (buf) logical.push(buf);

  const out: DockerfileInstruction[] = [];
  for (const raw of logical) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      out.push({ id: nid(), kind: "COMMENT", text: line.slice(1).trimStart() });
      continue;
    }
    const m = line.match(/^([A-Za-z]+)\s+(.*)$/s);
    if (!m) {
      out.push({ id: nid(), kind: "RAW", text: line });
      continue;
    }
    const op = m[1].toUpperCase();
    const rest = m[2].trim();
    switch (op) {
      case "FROM": {
        const plat = rest.match(/--platform=(\S+)\s+(.*)/);
        const body = plat ? plat[2] : rest;
        const platform = plat?.[1];
        const asM = body.match(/^(.*?)\s+[Aa][Ss]\s+(\S+)\s*$/);
        if (asM) {
          out.push({
            id: nid(),
            kind: "FROM",
            image: asM[1].trim(),
            as: asM[2],
            platform,
          });
        } else {
          out.push({ id: nid(), kind: "FROM", image: body, platform });
        }
        break;
      }
      case "ARG": {
        const eq = rest.indexOf("=");
        if (eq >= 0) {
          out.push({
            id: nid(),
            kind: "ARG",
            name: rest.slice(0, eq).trim(),
            defaultValue: rest.slice(eq + 1).trim(),
          });
        } else {
          out.push({ id: nid(), kind: "ARG", name: rest });
        }
        break;
      }
      case "ENV": {
        const pairs: { key: string; value: string }[] = [];
        if (rest.includes("=")) {
          const parts = splitShellWords(rest);
          for (const p of parts) {
            const i = p.indexOf("=");
            if (i >= 0)
              pairs.push({ key: p.slice(0, i), value: p.slice(i + 1) });
            else pairs.push({ key: p, value: "" });
          }
        } else {
          const parts = splitShellWords(rest);
          if (parts.length >= 2) {
            pairs.push({ key: parts[0], value: parts.slice(1).join(" ") });
          } else if (parts[0]) {
            pairs.push({ key: parts[0], value: "" });
          }
        }
        out.push({ id: nid(), kind: "ENV", pairs });
        break;
      }
      case "WORKDIR":
        out.push({ id: nid(), kind: "WORKDIR", path: rest });
        break;
      case "COPY":
      case "ADD": {
        const fromM = rest.match(/--from=(\S+)\s+(.*)/);
        const chownM = (fromM ? fromM[2] : rest).match(/--chown=(\S+)\s+(.*)/);
        let body = fromM ? fromM[2] : rest;
        const from = fromM?.[1];
        let chown: string | undefined;
        if (chownM) {
          chown = chownM[1];
          body = chownM[2];
        }
        const words = splitShellWords(body);
        const dest = words.pop() ?? "";
        const src = words.join(" ");
        if (op === "COPY") {
          out.push({ id: nid(), kind: "COPY", src, dest, from, chown });
        } else {
          out.push({ id: nid(), kind: "ADD", src, dest });
        }
        break;
      }
      case "RUN":
        out.push({ id: nid(), kind: "RUN", command: rest });
        break;
      case "EXPOSE":
        out.push({ id: nid(), kind: "EXPOSE", ports: splitShellWords(rest) });
        break;
      case "USER":
        out.push({ id: nid(), kind: "USER", user: rest });
        break;
      case "VOLUME": {
        const arr = parseJsonArray(rest);
        out.push({
          id: nid(),
          kind: "VOLUME",
          paths: arr ?? splitShellWords(rest),
        });
        break;
      }
      case "LABEL": {
        const pairs: { key: string; value: string }[] = [];
        for (const p of splitShellWords(rest)) {
          const i = p.indexOf("=");
          if (i >= 0) pairs.push({ key: p.slice(0, i), value: p.slice(i + 1) });
        }
        out.push({ id: nid(), kind: "LABEL", pairs });
        break;
      }
      case "HEALTHCHECK":
        out.push({ id: nid(), kind: "HEALTHCHECK", args: rest });
        break;
      case "SHELL": {
        const arr = parseJsonArray(rest) ?? splitShellWords(rest);
        out.push({ id: nid(), kind: "SHELL", form: arr });
        break;
      }
      case "CMD":
      case "ENTRYPOINT": {
        const arr = parseJsonArray(rest);
        if (arr) {
          out.push({
            id: nid(),
            kind: op as "CMD" | "ENTRYPOINT",
            form: "exec",
            value: JSON.stringify(arr),
          });
        } else {
          out.push({
            id: nid(),
            kind: op as "CMD" | "ENTRYPOINT",
            form: "shell",
            value: rest,
          });
        }
        break;
      }
      default:
        out.push({ id: nid(), kind: "RAW", text: line });
    }
  }
  return out;
}

/** 指令列表 → Dockerfile 源码 */
export function stringifyDockerfile(
  instructions: DockerfileInstruction[],
): string {
  const lines: string[] = [];
  for (const ins of instructions) {
    switch (ins.kind) {
      case "COMMENT":
        lines.push(`# ${ins.text}`);
        break;
      case "FROM": {
        const plat = ins.platform ? `--platform=${ins.platform} ` : "";
        const as = ins.as ? ` AS ${ins.as}` : "";
        lines.push(`FROM ${plat}${ins.image}${as}`);
        break;
      }
      case "ARG":
        lines.push(
          ins.defaultValue != null && ins.defaultValue !== ""
            ? `ARG ${ins.name}=${ins.defaultValue}`
            : `ARG ${ins.name}`,
        );
        break;
      case "ENV":
        lines.push(
          `ENV ${ins.pairs.map((p) => `${p.key}=${p.value}`).join(" ")}`,
        );
        break;
      case "WORKDIR":
        lines.push(`WORKDIR ${ins.path}`);
        break;
      case "COPY": {
        const flags = [
          ins.from ? `--from=${ins.from}` : "",
          ins.chown ? `--chown=${ins.chown}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        lines.push(`COPY ${flags ? `${flags} ` : ""}${ins.src} ${ins.dest}`);
        break;
      }
      case "ADD":
        lines.push(`ADD ${ins.src} ${ins.dest}`);
        break;
      case "RUN":
        lines.push(`RUN ${ins.command}`);
        break;
      case "EXPOSE":
        lines.push(`EXPOSE ${ins.ports.join(" ")}`);
        break;
      case "USER":
        lines.push(`USER ${ins.user}`);
        break;
      case "VOLUME":
        lines.push(`VOLUME ${JSON.stringify(ins.paths)}`);
        break;
      case "LABEL":
        lines.push(
          `LABEL ${ins.pairs.map((p) => `${p.key}=${p.value}`).join(" ")}`,
        );
        break;
      case "HEALTHCHECK":
        lines.push(`HEALTHCHECK ${ins.args}`);
        break;
      case "SHELL":
        lines.push(`SHELL ${JSON.stringify(ins.form)}`);
        break;
      case "CMD":
      case "ENTRYPOINT":
        if (ins.form === "exec") {
          lines.push(`${ins.kind} ${ins.value}`);
        } else {
          lines.push(`${ins.kind} ${ins.value}`);
        }
        break;
      case "RAW":
        lines.push(ins.text);
        break;
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 默认多阶段空白 Dockerfile */
export function emptyDockerfile(): string {
  return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["node","dist/index.js"]
`;
}

/** 创建空白指令 */
export function createInstruction(
  kind: DockerfileInstruction["kind"],
): DockerfileInstruction {
  const id = nid();
  switch (kind) {
    case "FROM":
      return { id, kind, image: "alpine:latest" };
    case "ARG":
      return { id, kind, name: "VERSION", defaultValue: "1" };
    case "ENV":
      return { id, kind, pairs: [{ key: "NODE_ENV", value: "production" }] };
    case "WORKDIR":
      return { id, kind, path: "/app" };
    case "COPY":
      return { id, kind, src: ".", dest: "." };
    case "ADD":
      return { id, kind, src: ".", dest: "." };
    case "RUN":
      return { id, kind, command: "echo ok" };
    case "EXPOSE":
      return { id, kind, ports: ["80"] };
    case "USER":
      return { id, kind, user: "node" };
    case "VOLUME":
      return { id, kind, paths: ["/data"] };
    case "LABEL":
      return { id, kind, pairs: [{ key: "maintainer", value: "xuanjian" }] };
    case "HEALTHCHECK":
      return { id, kind, args: "CMD wget -qO- http://127.0.0.1/ || exit 1" };
    case "SHELL":
      return { id, kind, form: ["/bin/sh", "-c"] };
    case "CMD":
      return { id, kind, form: "shell", value: "nginx -g 'daemon off;'" };
    case "ENTRYPOINT":
      return { id, kind, form: "exec", value: '["docker-entrypoint.sh"]' };
    case "COMMENT":
      return { id, kind, text: "note" };
    case "RAW":
      return { id, kind, text: "" };
  }
}
