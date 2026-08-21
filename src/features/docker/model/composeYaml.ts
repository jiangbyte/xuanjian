/**
 * @file Compose YAML 双向转换与校验
 * @author Charlie
 * @description 规范化 ComposeDoc ↔ YAML；解析失败时抛错，不静默丢字段。
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  emptyComposeDoc,
  type BuildConfig,
  type ComposeDoc,
  type ComposeNetwork,
  type ComposeService,
  type ComposeVolume,
  type DependsOnEntry,
  type Healthcheck,
  type PortMapping,
  type ServiceNetwork,
  type VolumeMount,
} from "./composeTypes";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => asString(x) ?? "").filter(Boolean);
}

function parsePorts(raw: unknown): PortMapping[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PortMapping[] = [];
  for (const item of raw) {
    if (typeof item === "string" || typeof item === "number") {
      const s = String(item);
      const m = s.match(/^(\d+(?:-\d+)?)(?::(\d+(?:-\d+)?))?(?:\/(tcp|udp))?$/i);
      if (m) {
        if (m[2]) {
          out.push({
            published: m[1],
            target: m[2],
            protocol: (m[3]?.toLowerCase() as "tcp" | "udp") || undefined,
          });
        } else {
          out.push({ target: m[1], protocol: (m[3]?.toLowerCase() as "tcp" | "udp") || undefined });
        }
      } else {
        out.push({ target: s });
      }
      continue;
    }
    if (isRecord(item)) {
      out.push({
        published: asString(item.published),
        target: asString(item.target) ?? asString(item.container_port) ?? "80",
        protocol: (asString(item.protocol)?.toLowerCase() as "tcp" | "udp") || undefined,
        mode: asString(item.mode),
      });
    }
  }
  return out;
}

function parseEnv(raw: unknown): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = asString(item);
      if (!s) continue;
      const i = s.indexOf("=");
      if (i >= 0) out[s.slice(0, i)] = s.slice(i + 1);
      else out[s] = "";
    }
    return out;
  }
  if (isRecord(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      out[k] = v == null ? "" : String(v);
    }
    return out;
  }
  return undefined;
}

function parseVolumes(raw: unknown): VolumeMount[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: VolumeMount[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const parts = item.split(":");
      if (parts.length >= 2) {
        const source = parts[0];
        const target = parts[1];
        const flags = parts[2] ?? "";
        const isBind = source.startsWith("/") || source.startsWith("./") || source.startsWith("~");
        out.push({
          type: isBind ? "bind" : "volume",
          source,
          target,
          readOnly: flags.includes("ro"),
        });
      }
      continue;
    }
    if (isRecord(item)) {
      const type = (asString(item.type) as VolumeMount["type"]) || "volume";
      out.push({
        type,
        source: asString(item.source) ?? "",
        target: asString(item.target) ?? "",
        readOnly: Boolean(item.read_only ?? item.readOnly),
      });
    }
  }
  return out;
}

function parseDependsOn(raw: unknown): DependsOnEntry[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw
      .map((x) => asString(x))
      .filter((x): x is string => Boolean(x))
      .map((service) => ({ service }));
  }
  if (isRecord(raw)) {
    return Object.entries(raw).map(([service, cfg]) => {
      const condition =
        isRecord(cfg) && typeof cfg.condition === "string"
          ? (cfg.condition as DependsOnEntry["condition"])
          : undefined;
      return { service, condition };
    });
  }
  return undefined;
}

function parseServiceNetworks(raw: unknown): ServiceNetwork[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw
      .map((x) => asString(x))
      .filter((x): x is string => Boolean(x))
      .map((name) => ({ name }));
  }
  if (isRecord(raw)) {
    return Object.entries(raw).map(([name, cfg]) => ({
      name,
      aliases: isRecord(cfg) ? asStringArray(cfg.aliases) : undefined,
    }));
  }
  return undefined;
}

function parseBuild(raw: unknown): BuildConfig | undefined {
  if (typeof raw === "string") return { context: raw };
  if (!isRecord(raw)) return undefined;
  const args = parseEnv(raw.args);
  return {
    context: asString(raw.context) ?? ".",
    dockerfile: asString(raw.dockerfile),
    args,
    target: asString(raw.target),
  };
}

function parseHealthcheck(raw: unknown): Healthcheck | undefined {
  if (!isRecord(raw)) return undefined;
  let test: string[] = [];
  if (Array.isArray(raw.test)) test = raw.test.map((x) => String(x));
  else if (typeof raw.test === "string") test = ["CMD-SHELL", raw.test];
  return {
    test,
    interval: asString(raw.interval),
    timeout: asString(raw.timeout),
    retries: typeof raw.retries === "number" ? raw.retries : undefined,
    start_period: asString(raw.start_period),
    disable: Boolean(raw.disable),
  };
}

function parseService(raw: unknown): ComposeService {
  if (!isRecord(raw)) return {};
  const cmd = raw.command;
  const entry = raw.entrypoint;
  return {
    image: asString(raw.image),
    build: parseBuild(raw.build),
    container_name: asString(raw.container_name),
    restart: asString(raw.restart),
    profiles: asStringArray(raw.profiles),
    command: Array.isArray(cmd)
      ? cmd.map(String)
      : typeof cmd === "string"
        ? cmd
        : undefined,
    entrypoint: Array.isArray(entry)
      ? entry.map(String)
      : typeof entry === "string"
        ? entry
        : undefined,
    working_dir: asString(raw.working_dir),
    user: asString(raw.user),
    hostname: asString(raw.hostname),
    privileged: raw.privileged === true ? true : undefined,
    stdin_open: raw.stdin_open === true ? true : undefined,
    tty: raw.tty === true ? true : undefined,
    ports: parsePorts(raw.ports),
    environment: parseEnv(raw.environment),
    env_file: asStringArray(raw.env_file) ?? (typeof raw.env_file === "string" ? [raw.env_file] : undefined),
    volumes: parseVolumes(raw.volumes),
    networks: parseServiceNetworks(raw.networks),
    depends_on: parseDependsOn(raw.depends_on),
    healthcheck: parseHealthcheck(raw.healthcheck),
    extra_hosts: asStringArray(raw.extra_hosts),
    dns: asStringArray(raw.dns),
    cap_add: asStringArray(raw.cap_add),
    cap_drop: asStringArray(raw.cap_drop),
    labels: parseEnv(raw.labels),
    logging: isRecord(raw.logging)
      ? {
          driver: asString(raw.logging.driver),
          options: parseEnv(raw.logging.options),
        }
      : undefined,
    ulimits: isRecord(raw.ulimits)
      ? (raw.ulimits as ComposeService["ulimits"])
      : undefined,
  };
}

function parseTopNetworks(raw: unknown): Record<string, ComposeNetwork> {
  const out: Record<string, ComposeNetwork> = {};
  if (!isRecord(raw)) return out;
  for (const [name, cfg] of Object.entries(raw)) {
    if (cfg == null) {
      out[name] = { name };
      continue;
    }
    if (!isRecord(cfg)) {
      out[name] = { name };
      continue;
    }
    out[name] = {
      name,
      driver: asString(cfg.driver),
      external: cfg.external === true || isRecord(cfg.external),
      labels: parseEnv(cfg.labels),
    };
  }
  return out;
}

function parseTopVolumes(raw: unknown): Record<string, ComposeVolume> {
  const out: Record<string, ComposeVolume> = {};
  if (!isRecord(raw)) return out;
  for (const [name, cfg] of Object.entries(raw)) {
    if (!isRecord(cfg) || cfg == null) {
      out[name] = { name };
      continue;
    }
    out[name] = {
      name,
      driver: asString(cfg.driver),
      external: cfg.external === true || isRecord(cfg.external),
      labels: parseEnv(cfg.labels),
    };
  }
  return out;
}

/** YAML 文本 → ComposeDoc */
export function parseComposeYaml(text: string): ComposeDoc {
  const doc = emptyComposeDoc();
  if (!text.trim()) return doc;
  const parsed = parseYaml(text);
  if (!isRecord(parsed)) throw new Error("YAML root must be a mapping");

  if (typeof parsed.name === "string") doc.name = parsed.name;

  if (isRecord(parsed.services)) {
    for (const [name, svc] of Object.entries(parsed.services)) {
      doc.services[name] = parseService(svc);
    }
  }

  doc.networks = parseTopNetworks(parsed.networks);
  doc.volumes = parseTopVolumes(parsed.volumes);

  // ensure referenced networks/volumes exist as top-level stubs
  for (const svc of Object.values(doc.services)) {
    for (const n of svc.networks ?? []) {
      if (!doc.networks[n.name]) doc.networks[n.name] = { name: n.name };
    }
    for (const v of svc.volumes ?? []) {
      if (v.type === "volume" && v.source && !doc.volumes[v.source]) {
        doc.volumes[v.source] = { name: v.source };
      }
    }
  }

  return doc;
}

function dumpPorts(ports?: PortMapping[]): unknown[] | undefined {
  if (!ports?.length) return undefined;
  return ports.map((p) => {
    if (p.published && p.protocol) return `${p.published}:${p.target}/${p.protocol}`;
    if (p.published) return `${p.published}:${p.target}`;
    if (p.protocol) return `${p.target}/${p.protocol}`;
    return p.target;
  });
}

function dumpEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env || !Object.keys(env).length) return undefined;
  return { ...env };
}

function dumpVolumes(vols?: VolumeMount[]): unknown[] | undefined {
  if (!vols?.length) return undefined;
  return vols.map((v) => {
    if (v.type === "bind" || v.type === "volume") {
      const base = `${v.source}:${v.target}`;
      return v.readOnly ? `${base}:ro` : base;
    }
    return { type: "tmpfs", target: v.target };
  });
}

function dumpDependsOn(deps?: DependsOnEntry[]): unknown {
  if (!deps?.length) return undefined;
  const hasCond = deps.some((d) => d.condition);
  if (!hasCond) return deps.map((d) => d.service);
  const out: Record<string, { condition: string }> = {};
  for (const d of deps) {
    out[d.service] = { condition: d.condition ?? "service_started" };
  }
  return out;
}

function dumpNetworks(nets?: ServiceNetwork[]): unknown {
  if (!nets?.length) return undefined;
  const hasAlias = nets.some((n) => n.aliases?.length);
  if (!hasAlias) return nets.map((n) => n.name);
  const out: Record<string, { aliases?: string[] }> = {};
  for (const n of nets) {
    out[n.name] = n.aliases?.length ? { aliases: n.aliases } : {};
  }
  return out;
}

function dumpService(svc: ComposeService): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (svc.image) o.image = svc.image;
  if (svc.build) {
    const b: Record<string, unknown> = { context: svc.build.context || "." };
    if (svc.build.dockerfile) b.dockerfile = svc.build.dockerfile;
    if (svc.build.target) b.target = svc.build.target;
    if (svc.build.args && Object.keys(svc.build.args).length) b.args = svc.build.args;
    o.build = b;
  }
  if (svc.container_name) o.container_name = svc.container_name;
  if (svc.restart) o.restart = svc.restart;
  if (svc.profiles?.length) o.profiles = svc.profiles;
  if (svc.command != null) o.command = svc.command;
  if (svc.entrypoint != null) o.entrypoint = svc.entrypoint;
  if (svc.working_dir) o.working_dir = svc.working_dir;
  if (svc.user) o.user = svc.user;
  if (svc.hostname) o.hostname = svc.hostname;
  if (svc.privileged) o.privileged = true;
  if (svc.stdin_open) o.stdin_open = true;
  if (svc.tty) o.tty = true;
  const ports = dumpPorts(svc.ports);
  if (ports) o.ports = ports;
  const env = dumpEnv(svc.environment);
  if (env) o.environment = env;
  if (svc.env_file?.length) o.env_file = svc.env_file;
  const vols = dumpVolumes(svc.volumes);
  if (vols) o.volumes = vols;
  const nets = dumpNetworks(svc.networks);
  if (nets) o.networks = nets;
  const deps = dumpDependsOn(svc.depends_on);
  if (deps) o.depends_on = deps;
  if (svc.healthcheck && !svc.healthcheck.disable) {
    const h: Record<string, unknown> = { test: svc.healthcheck.test };
    if (svc.healthcheck.interval) h.interval = svc.healthcheck.interval;
    if (svc.healthcheck.timeout) h.timeout = svc.healthcheck.timeout;
    if (svc.healthcheck.retries != null) h.retries = svc.healthcheck.retries;
    if (svc.healthcheck.start_period) h.start_period = svc.healthcheck.start_period;
    o.healthcheck = h;
  }
  if (svc.extra_hosts?.length) o.extra_hosts = svc.extra_hosts;
  if (svc.dns?.length) o.dns = svc.dns;
  if (svc.cap_add?.length) o.cap_add = svc.cap_add;
  if (svc.cap_drop?.length) o.cap_drop = svc.cap_drop;
  if (svc.ulimits && Object.keys(svc.ulimits).length) o.ulimits = svc.ulimits;
  const labels = dumpEnv(svc.labels);
  if (labels) o.labels = labels;
  if (svc.logging?.driver || svc.logging?.options) {
    o.logging = {
      ...(svc.logging.driver ? { driver: svc.logging.driver } : {}),
      ...(svc.logging.options ? { options: svc.logging.options } : {}),
    };
  }
  return o;
}

/** ComposeDoc → YAML 文本 */
export function stringifyComposeYaml(doc: ComposeDoc): string {
  const root: Record<string, unknown> = {};
  if (doc.name) root.name = doc.name;

  const services: Record<string, unknown> = {};
  for (const name of Object.keys(doc.services).sort()) {
    services[name] = dumpService(doc.services[name]);
  }
  if (Object.keys(services).length) root.services = services;

  const networks: Record<string, unknown> = {};
  for (const name of Object.keys(doc.networks).sort()) {
    const n = doc.networks[name];
    const body: Record<string, unknown> = {};
    if (n.driver) body.driver = n.driver;
    if (n.external) body.external = true;
    if (n.labels && Object.keys(n.labels).length) body.labels = n.labels;
    networks[name] = Object.keys(body).length ? body : null;
  }
  if (Object.keys(networks).length) root.networks = networks;

  const volumes: Record<string, unknown> = {};
  for (const name of Object.keys(doc.volumes).sort()) {
    const v = doc.volumes[name];
    const body: Record<string, unknown> = {};
    if (v.driver) body.driver = v.driver;
    if (v.external) body.external = true;
    if (v.labels && Object.keys(v.labels).length) body.labels = v.labels;
    volumes[name] = Object.keys(body).length ? body : null;
  }
  if (Object.keys(volumes).length) root.volumes = volumes;

  return stringifyYaml(root, { indent: 2, lineWidth: 0 });
}

/** 校验问题 */
export type ComposeIssue = {
  level: "error" | "warn";
  message: string;
  service?: string;
};

/** 结构校验 */
export function validateComposeDoc(doc: ComposeDoc): ComposeIssue[] {
  const issues: ComposeIssue[] = [];
  const serviceNames = new Set(Object.keys(doc.services));

  for (const [name, svc] of Object.entries(doc.services)) {
    if (!svc.image && !svc.build) {
      issues.push({
        level: "error",
        service: name,
        message: `Service "${name}" needs image or build`,
      });
    }
    for (const dep of svc.depends_on ?? []) {
      if (!serviceNames.has(dep.service)) {
        issues.push({
          level: "error",
          service: name,
          message: `depends_on unknown service "${dep.service}"`,
        });
      }
    }
    for (const n of svc.networks ?? []) {
      if (!doc.networks[n.name]) {
        issues.push({
          level: "warn",
          service: name,
          message: `network "${n.name}" not declared at top-level`,
        });
      }
    }
    for (const v of svc.volumes ?? []) {
      if (v.type === "volume" && v.source && !doc.volumes[v.source]) {
        issues.push({
          level: "warn",
          service: name,
          message: `volume "${v.source}" not declared at top-level`,
        });
      }
      if (!v.target) {
        issues.push({
          level: "error",
          service: name,
          message: "volume mount missing target",
        });
      }
    }
    for (const p of svc.ports ?? []) {
      if (!/^\d+(-\d+)?$/.test(p.target)) {
        issues.push({
          level: "warn",
          service: name,
          message: `unusual port target "${p.target}"`,
        });
      }
    }
  }

  // cycle detection on depends_on
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (n: string): boolean => {
    if (visited.has(n)) return false;
    if (visiting.has(n)) return true;
    visiting.add(n);
    for (const d of doc.services[n]?.depends_on ?? []) {
      if (dfs(d.service)) return true;
    }
    visiting.delete(n);
    visited.add(n);
    return false;
  };
  for (const n of serviceNames) {
    if (dfs(n)) {
      issues.push({ level: "error", message: "Circular depends_on detected" });
      break;
    }
  }

  return issues;
}
