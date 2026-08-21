/**
 * @file Docker 编排内置模板
 * @author Charlie
 * @description 按项目形态（compose / dockerfile / full）提供种子数据。
 */

import type { DockerProjectKind } from "@/lib/db/dockerProjects";
import type { ComposeDoc, DockerfilesMap } from "../model/composeTypes";
import { stringifyComposeYaml } from "../model/composeYaml";

export type DockerTemplate = {
  id: string;
  nameKey: string;
  descriptionKey: string;
  kind: DockerProjectKind;
  compose: ComposeDoc;
  dockerfiles: DockerfilesMap;
};

const emptyCompose = (): ComposeDoc => ({
  services: {},
  networks: {},
  volumes: {},
});

const starterDockerfile = `FROM alpine:3.20
WORKDIR /app
CMD ["sh"]
`;

const nginxDockerfile = `FROM nginx:alpine
COPY ./html /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;

const apiDockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["node", "dist/index.js"]
`;

export const DOCKER_TEMPLATES: DockerTemplate[] = [
  {
    id: "blank-compose",
    nameKey: "docker.tplBlankCompose",
    descriptionKey: "docker.tplBlankComposeDesc",
    kind: "compose",
    compose: emptyCompose(),
    dockerfiles: {},
  },
  {
    id: "blank-dockerfile",
    nameKey: "docker.tplBlankDockerfile",
    descriptionKey: "docker.tplBlankDockerfileDesc",
    kind: "dockerfile",
    compose: emptyCompose(),
    dockerfiles: { Dockerfile: starterDockerfile },
  },
  {
    id: "blank-full",
    nameKey: "docker.tplBlankFull",
    descriptionKey: "docker.tplBlankFullDesc",
    kind: "full",
    compose: emptyCompose(),
    dockerfiles: {},
  },
  {
    id: "nginx",
    nameKey: "docker.tplNginx",
    descriptionKey: "docker.tplNginxDesc",
    kind: "full",
    compose: {
      name: "nginx-static",
      services: {
        web: {
          build: { context: ".", dockerfile: "Dockerfile" },
          ports: [{ published: "8080", target: "80" }],
          restart: "unless-stopped",
          volumes: [
            {
              type: "bind",
              source: "./html",
              target: "/usr/share/nginx/html",
              readOnly: true,
            },
          ],
          networks: [{ name: "frontend" }],
        },
      },
      networks: { frontend: { name: "frontend" } },
      volumes: {},
    },
    dockerfiles: { Dockerfile: nginxDockerfile },
  },
  {
    id: "redis",
    nameKey: "docker.tplRedis",
    descriptionKey: "docker.tplRedisDesc",
    kind: "compose",
    compose: {
      name: "redis",
      services: {
        redis: {
          image: "redis:7-alpine",
          ports: [{ published: "6379", target: "6379" }],
          restart: "unless-stopped",
          volumes: [{ type: "volume", source: "redis_data", target: "/data" }],
          command: "redis-server --appendonly yes",
          networks: [{ name: "cache" }],
        },
      },
      networks: { cache: { name: "cache" } },
      volumes: { redis_data: { name: "redis_data" } },
    },
    dockerfiles: {},
  },
  {
    id: "mysql",
    nameKey: "docker.tplMysql",
    descriptionKey: "docker.tplMysqlDesc",
    kind: "compose",
    compose: {
      name: "mysql",
      services: {
        db: {
          image: "mysql:8.4",
          container_name: "mysql",
          restart: "unless-stopped",
          ports: [{ published: "3306", target: "3306" }],
          environment: {
            MYSQL_ROOT_PASSWORD: "rootpass",
            MYSQL_DATABASE: "app",
            MYSQL_USER: "app",
            MYSQL_PASSWORD: "apppass",
          },
          volumes: [
            { type: "volume", source: "mysql_data", target: "/var/lib/mysql" },
          ],
          networks: [{ name: "dbnet" }],
          healthcheck: {
            test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"],
            interval: "10s",
            timeout: "5s",
            retries: 5,
          },
        },
      },
      networks: { dbnet: { name: "dbnet" } },
      volumes: { mysql_data: { name: "mysql_data" } },
    },
    dockerfiles: {},
  },
  {
    id: "node-postgres",
    nameKey: "docker.tplNodePg",
    descriptionKey: "docker.tplNodePgDesc",
    kind: "full",
    compose: {
      name: "api-postgres",
      services: {
        api: {
          build: { context: "./api", dockerfile: "Dockerfile" },
          ports: [{ published: "3000", target: "3000" }],
          environment: {
            DATABASE_URL: "postgres://app:apppass@db:5432/app",
            NODE_ENV: "production",
          },
          depends_on: [{ service: "db", condition: "service_healthy" }],
          networks: [{ name: "appnet" }],
          restart: "unless-stopped",
        },
        db: {
          image: "postgres:16-alpine",
          environment: {
            POSTGRES_USER: "app",
            POSTGRES_PASSWORD: "apppass",
            POSTGRES_DB: "app",
          },
          volumes: [
            {
              type: "volume",
              source: "pg_data",
              target: "/var/lib/postgresql/data",
            },
          ],
          networks: [{ name: "appnet" }],
          healthcheck: {
            test: ["CMD-SHELL", "pg_isready -U app -d app"],
            interval: "5s",
            timeout: "5s",
            retries: 10,
          },
        },
      },
      networks: { appnet: { name: "appnet" } },
      volumes: { pg_data: { name: "pg_data" } },
    },
    dockerfiles: { "api/Dockerfile": apiDockerfile },
  },
  {
    id: "fullstack",
    nameKey: "docker.tplFullstack",
    descriptionKey: "docker.tplFullstackDesc",
    kind: "full",
    compose: {
      name: "fullstack",
      services: {
        web: {
          image: "nginx:alpine",
          ports: [{ published: "8080", target: "80" }],
          volumes: [
            {
              type: "bind",
              source: "./web/nginx.conf",
              target: "/etc/nginx/conf.d/default.conf",
              readOnly: true,
            },
          ],
          depends_on: [{ service: "api" }],
          networks: [{ name: "frontend" }, { name: "backend" }],
        },
        api: {
          build: { context: "./api", dockerfile: "Dockerfile" },
          environment: {
            DATABASE_URL: "postgres://app:apppass@db:5432/app",
            REDIS_URL: "redis://redis:6379",
          },
          depends_on: [
            { service: "db", condition: "service_healthy" },
            { service: "redis" },
          ],
          networks: [{ name: "backend" }],
        },
        db: {
          image: "postgres:16-alpine",
          environment: {
            POSTGRES_USER: "app",
            POSTGRES_PASSWORD: "apppass",
            POSTGRES_DB: "app",
          },
          volumes: [
            {
              type: "volume",
              source: "pg_data",
              target: "/var/lib/postgresql/data",
            },
          ],
          networks: [{ name: "backend" }],
          healthcheck: {
            test: ["CMD-SHELL", "pg_isready -U app"],
            interval: "5s",
            timeout: "5s",
            retries: 10,
          },
        },
        redis: {
          image: "redis:7-alpine",
          networks: [{ name: "backend" }],
          volumes: [{ type: "volume", source: "redis_data", target: "/data" }],
        },
      },
      networks: {
        frontend: { name: "frontend" },
        backend: { name: "backend" },
      },
      volumes: {
        pg_data: { name: "pg_data" },
        redis_data: { name: "redis_data" },
      },
    },
    dockerfiles: { "api/Dockerfile": apiDockerfile },
  },
  {
    id: "multistage-df",
    nameKey: "docker.tplMultistage",
    descriptionKey: "docker.tplMultistageDesc",
    kind: "dockerfile",
    compose: emptyCompose(),
    dockerfiles: { Dockerfile: apiDockerfile },
  },
];

export function templatesForKind(kind: DockerProjectKind): DockerTemplate[] {
  return DOCKER_TEMPLATES.filter((t) => t.kind === kind);
}

export function templateSeedYaml(tpl: DockerTemplate): string {
  return stringifyComposeYaml(tpl.compose);
}
