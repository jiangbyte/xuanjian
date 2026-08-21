/**
 * @file Compose 规范化文档类型
 * @author Charlie
 * @description 画布与 YAML 共用的权威模型（Compose Spec 日常子集）。
 */

/** named volume / bind / tmpfs 挂载 */
export type VolumeMount = {
  type: "volume" | "bind" | "tmpfs";
  source: string;
  target: string;
  readOnly?: boolean;
};

/** 端口映射 */
export type PortMapping = {
  published?: string;
  target: string;
  protocol?: "tcp" | "udp";
  mode?: string;
};

/** depends_on 条目 */
export type DependsOnEntry = {
  service: string;
  condition?: "service_started" | "service_healthy" | "service_completed_successfully";
};

/** 服务附加网络 */
export type ServiceNetwork = {
  name: string;
  aliases?: string[];
};

/** build 配置 */
export type BuildConfig = {
  context: string;
  dockerfile?: string;
  args?: Record<string, string>;
  target?: string;
};

/** healthcheck */
export type Healthcheck = {
  test: string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
  disable?: boolean;
};

/** logging */
export type LoggingConfig = {
  driver?: string;
  options?: Record<string, string>;
};

/** Compose service */
export type ComposeService = {
  image?: string;
  build?: BuildConfig;
  container_name?: string;
  restart?: string;
  profiles?: string[];
  command?: string | string[];
  entrypoint?: string | string[];
  working_dir?: string;
  user?: string;
  hostname?: string;
  privileged?: boolean;
  stdin_open?: boolean;
  tty?: boolean;
  ports?: PortMapping[];
  environment?: Record<string, string>;
  env_file?: string[];
  volumes?: VolumeMount[];
  networks?: ServiceNetwork[];
  depends_on?: DependsOnEntry[];
  healthcheck?: Healthcheck;
  extra_hosts?: string[];
  dns?: string[];
  cap_add?: string[];
  cap_drop?: string[];
  ulimits?: Record<string, string | number | { soft: number; hard: number }>;
  labels?: Record<string, string>;
  logging?: LoggingConfig;
};

/** 顶层 network */
export type ComposeNetwork = {
  name: string;
  driver?: string;
  external?: boolean;
  labels?: Record<string, string>;
};

/** 顶层 volume */
export type ComposeVolume = {
  name: string;
  driver?: string;
  external?: boolean;
  labels?: Record<string, string>;
};

/** 权威 Compose 文档 */
export type ComposeDoc = {
  name?: string;
  services: Record<string, ComposeService>;
  networks: Record<string, ComposeNetwork>;
  volumes: Record<string, ComposeVolume>;
};

/** 项目内 Dockerfile 映射 path -> content */
export type DockerfilesMap = Record<string, string>;

/** 空文档 */
export function emptyComposeDoc(): ComposeDoc {
  return { services: {}, networks: {}, volumes: {} };
}

/** 默认空服务 */
export function emptyService(): ComposeService {
  return {
    image: "nginx:alpine",
    restart: "unless-stopped",
    ports: [],
    environment: {},
    volumes: [],
    networks: [],
    depends_on: [],
  };
}
