/**
 * @file 首次启动示例数据
 * @description 各模块为空时注入占位示例，便于了解数据结构；与普通记录一样可编辑、删除。
 */

import { DOCKER_TEMPLATES } from "@/features/docker/templates";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type XuanjianExport,
} from "@/lib/share/types";

export const SAMPLE_DATA_BOOTSTRAP_KEY = "bootstrap.sample_data_v1";

/** 示例项统一前缀，便于识别与批量清理 */
export const SAMPLE_PREFIX = "示例 · ";

function exportBase(): Pick<
  XuanjianExport,
  "format" | "version" | "exportedAt"
> {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
  };
}

/** 主机示例 */
export function sampleHostsExport(): XuanjianExport {
  const group = `${SAMPLE_PREFIX}分组`;
  return {
    ...exportBase(),
    hosts: {
      groups: [{ name: group }, { name: "生产环境" }],
      items: [
        {
          name: `${SAMPLE_PREFIX}跳板机`,
          host: "bastion.example.com",
          port: 22,
          username: "ops",
          auth_type: "password",
          group,
          tags: ["示例", "跳板"],
          remark: "占位数据，可删除。",
          color: "#2563eb",
          remote_path: "/home/ops",
        },
        {
          name: `${SAMPLE_PREFIX}Web 服务器`,
          host: "192.168.1.10",
          port: 22,
          username: "deploy",
          auth_type: "password",
          group: "生产环境",
          tags: ["示例", "web"],
          jump_host: `${SAMPLE_PREFIX}跳板机`,
          remark: "占位数据，可删除。",
          color: "#059669",
          startup_cmd: "cd /var/www && exec $SHELL -l",
          remote_path: "/var/www",
        },
        {
          name: `${SAMPLE_PREFIX}开发机`,
          host: "dev.local",
          port: 22,
          username: "developer",
          auth_type: "password",
          group,
          tags: ["示例", "dev"],
          remark: "占位数据，可删除。",
          color: "#d97706",
          terminal_type: "xterm-256color",
        },
      ],
    },
  };
}

/** 脚本示例 */
export function sampleScriptsExport(): XuanjianExport {
  const pkgOps = `${SAMPLE_PREFIX}运维`;
  const pkgDev = `${SAMPLE_PREFIX}开发`;
  return {
    ...exportBase(),
    scripts: {
      packages: [{ name: pkgOps }, { name: pkgDev }],
      items: [
        {
          name: "磁盘用量",
          package: pkgOps,
          description: "df -hT",
          body: "df -hT\n",
          send_mode: "once",
        },
        {
          name: "内存概况",
          package: pkgOps,
          description: "free -h",
          body: "free -h\n",
          send_mode: "once",
        },
        {
          name: "监听端口",
          package: pkgOps,
          description: "ss -tlnp",
          body: "ss -tlnp | head -30\n",
          send_mode: "once",
        },
        {
          name: "系统信息",
          package: pkgOps,
          description: "uname / os-release",
          body: "uname -a && cat /etc/os-release 2>/dev/null | head -5\n",
          send_mode: "once",
        },
        {
          name: "Git 状态",
          package: pkgDev,
          description: "git status -sb",
          body: "git status -sb && git remote -v\n",
          send_mode: "once",
        },
        {
          name: "分批执行",
          package: pkgDev,
          description: "按行发送的三条命令",
          body: "echo step-1\necho step-2\necho step-3\n",
          send_mode: "line",
        },
      ],
    },
  };
}

/** 笔记示例（运维备忘风格，非产品说明） */
export function sampleNotesExport(): XuanjianExport {
  const cat = `${SAMPLE_PREFIX}备忘`;
  return {
    ...exportBase(),
    notes: {
      categories: [{ name: cat }],
      items: [
        {
          title: `${SAMPLE_PREFIX}Web 环境变量`,
          category: cat,
          pinned: true,
          body: `NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgres://app:***@db.internal:5432/app
REDIS_URL=redis://cache.internal:6379/0
`,
        },
        {
          title: `${SAMPLE_PREFIX}发版检查`,
          category: cat,
          body: `- [ ] 备份数据库
- [ ] 确认镜像 tag
- [ ] 滚动发布 / 蓝绿切换
- [ ] 健康检查通过
- [ ] 回滚包已准备
`,
        },
        {
          title: `${SAMPLE_PREFIX}MySQL 备份`,
          category: cat,
          body: `\`\`\`bash
mysqldump -h 127.0.0.1 -u backup -p app \\
  --single-transaction --routines --triggers \\
  > /backup/app-$(date +%F).sql
\`\`\`
`,
        },
        {
          title: `${SAMPLE_PREFIX}值班联系人`,
          category: cat,
          body: `| 角色 | 姓名 | 电话 |
|------|------|------|
| 值班 | 张三 | 138****0001 |
| 备份 | 李四 | 138****0002 |
`,
        },
      ],
    },
  };
}

function templateById(id: string) {
  return DOCKER_TEMPLATES.find((t) => t.id === id);
}

/** Docker 示例项目 */
export const SAMPLE_DOCKER_PROJECTS = [
  {
    name: `${SAMPLE_PREFIX}Nginx 静态站`,
    description: "Nginx + Dockerfile，8080 端口。",
    templateId: "nginx",
  },
  {
    name: `${SAMPLE_PREFIX}Redis 缓存`,
    description: "Redis 7 单节点，6379 端口。",
    templateId: "redis",
  },
  {
    name: `${SAMPLE_PREFIX}精简 Dockerfile`,
    description: "Alpine 基础镜像。",
    templateId: "blank-dockerfile",
  },
] as const;

export function sampleDockerProjectInput(
  name: string,
  description: string,
  templateId: string,
) {
  const tpl = templateById(templateId);
  if (!tpl) return null;
  return {
    name,
    description,
    kind: tpl.kind,
    compose_json: JSON.stringify(tpl.compose),
    dockerfiles_json: JSON.stringify(tpl.dockerfiles),
    layout_json: "{}",
  };
}
