/**
 * @file Agent 工具 JSON Schema 定义
 * @author Charlie
 */

import type { AgentToolDef } from "@/lib/agent/tools/types";

const TAB_ID_PROP = {
  tab_id: {
    type: "string",
    description:
      "当前焦点标签 ID（须与 list_sessions 中 active=true 一致；禁止跨标签）。",
  },
} as const;

const EXEC_TARGET_PROPS = {
  tab_id: TAB_ID_PROP.tab_id,
  shell_id: {
    type: "string",
    description:
      "仅用于校验：须与当前焦点标签 shellId 一致（如 local:wsl:Ubuntu），不会自动打开其他标签。",
  },
  plane: {
    type: "string",
    enum: ["wsl", "ssh"],
    description:
      "仅用于校验：plane=wsl/ssh 须与当前焦点标签类型一致，不会自动新建或切换标签。",
  },
  wsl_distro: {
    type: "string",
    description: "仅校验：WSL 发行版名须与当前 WSL 标签一致",
  },
  host_id: {
    type: "number",
    description: "仅校验：SSH host_id 须与当前 SSH 标签一致",
  },
} as const;

export const TOOL_DEFS: AgentToolDef[] = [
  {
    type: "function",
    function: {
      name: "terminal_tail",
      description:
        "读取 Agent 下栏终端最近输出。wait_ms 为最长阻塞等待：出现 shell 提示符或错误静默则提前返回；长任务（≥5s）不会因短暂无输出提前结束。优先一次给足 wait_ms（如 60000~180000）；仅当 still_running=true 且已等到 deadline 时再按 suggested_next_wait_ms 加大单次等待。禁止短间隔反复调用。",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string", description: "可选，默认活动会话" },
          max_chars: { type: "number", description: "默认 12000" },
          wait_ms: {
            type: "number",
            description:
              "最长阻塞等待毫秒（0=立即快照，最大 600000）。长任务请一次给足，工具会等到提示符或截止。",
          },
          stable_ms: {
            type: "number",
            description:
              "短等待时：输出连续不变多少毫秒视为静默（默认 1500）。长 wait_ms 下静默阈值会自动抬到整段等待窗口。",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_sessions",
      description:
        "列出 openTabs、availableShells、availableHosts；仅 active=true 的焦点标签可用于执行。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "host_info",
      description: "查询主机库存信息（默认当前标签绑定主机）",
      parameters: {
        type: "object",
        properties: { host_id: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_hosts",
      description: "列出已保存主机",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scripts",
      description:
        "列出本地脚本库（包/名称/描述）。需要正文时再用 get_script。",
      parameters: {
        type: "object",
        properties: {
          package_id: { type: "number" },
          query: { type: "string" },
          include_body: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_script",
      description: "读取脚本库中某条脚本的完整正文与变量占位符。",
      parameters: {
        type: "object",
        properties: { script_id: { type: "number" } },
        required: ["script_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_cmd_history",
      description: "读取终端历史命令，可按会话或关键词筛选。",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_run",
      description:
        "在【Agent 下栏终端】中执行命令（用户可见）。长任务一次给足 wait_ms（≥预计耗时）；工具阻塞到提示符或截止，不会因短暂无输出提前结束。仅 still_running 且 deadline 时再加大 wait，勿高频短轮询。",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
          command: { type: "string" },
          wait_ms: {
            type: "number",
            description: "最长等待毫秒（最大 600000）；长任务建议 ≥30000",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "session_exec",
      description:
        "在【Agent 下栏终端】执行命令（与 terminal_run 相同，用户可见）。仅在当前焦点标签对应环境下执行。",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_script",
      description: "将脚本库中的脚本写入 Agent 下栏终端执行（用户可见）。",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          script_id: { type: "number" },
          session_id: { type: "string" },
          vars: { type: "object", additionalProperties: { type: "string" } },
          wait_ms: { type: "number" },
        },
        required: ["script_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "host_metrics",
      description: "对指定标签会话做 CPU/内存/磁盘探测（旁路执行）",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_batch",
      description:
        "在多台主机上并发执行脚本库脚本（最多 5 路并发）。需 script_id 与 host_ids 或 host_group_id。",
      parameters: {
        type: "object",
        properties: {
          script_id: { type: "number" },
          host_ids: { type: "array", items: { type: "number" } },
          host_group_id: { type: "number" },
          vars: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["script_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_inspection_report",
      description:
        "对指定主机或分组生成只读巡检报告（CPU/内存/磁盘探测摘要）。",
      parameters: {
        type: "object",
        properties: {
          host_ids: { type: "array", items: { type: "number" } },
          host_group_id: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_compose_up",
      description:
        "在指定标签会话旁路执行 docker compose up -d（WSL 或 SSH 内 Docker）。",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
          compose_file: {
            type: "string",
            description: "可选 compose 文件路径",
          },
          detach: { type: "boolean", description: "默认 true（-d）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出当前焦点标签文件端点下的目录（local/WSL/SFTP）。",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          path: { type: "string", description: "目录路径，默认 ." },
          limit: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文件内容（只读，大文件会截断）",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          path: { type: "string" },
          max_chars: { type: "number" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_info",
      description: "查询单个文件/目录元数据（大小、mtime、权限）",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ping",
      description: "ICMP ping 目标主机（本机网络栈）",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string" },
          count: { type: "number" },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dns_lookup",
      description: "DNS 查询",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string" },
          record_type: { type: "string", description: "A/AAAA/MX/TXT 等" },
        },
        required: ["host"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tcp_probe",
      description: "TCP 端口连通性探测",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string" },
          ports: { type: "array", items: { type: "number" } },
          timeout_ms: { type: "number" },
        },
        required: ["host", "ports"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tls_cert",
      description: "获取 TLS 证书信息（host:port）",
      parameters: {
        type: "object",
        properties: {
          host_port: { type: "string", description: "如 example.com:443" },
        },
        required: ["host_port"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_ps",
      description: "列出指定标签会话内的 Docker 容器",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
          all: { type: "boolean", description: "含已停止，默认 true" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_logs",
      description: "读取指定标签会话内容器日志尾部",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
          container: { type: "string" },
          tail: { type: "number" },
        },
        required: ["container"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_inspect",
      description: "在指定标签会话内 docker inspect 容器/镜像",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
          container: { type: "string" },
        },
        required: ["container"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "按关键词搜索笔记标题与正文",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_session_logs",
      description: "搜索会话录制元数据",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string", enum: ["ssh", "local"] },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_cmd_history",
      description: "按关键词搜索命令历史",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "port_snapshot",
      description: "采集指定标签会话监听端口快照",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "disk_snapshot",
      description: "采集指定标签会话磁盘使用快照（df）",
      parameters: {
        type: "object",
        properties: {
          ...EXEC_TARGET_PROPS,
          session_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upload_file",
      description: "将工作空间内本地文件上传到远程（路径沙箱）",
      parameters: {
        type: "object",
        properties: {
          workspace_id: { type: "number" },
          local_path: { type: "string" },
          remote_path: { type: "string" },
        },
        required: ["local_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upload_tree",
      description: "上传工作空间子树（mtime 对比后入队）",
      parameters: {
        type: "object",
        properties: {
          workspace_id: { type: "number" },
          local_subpath: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_to_remote",
      description:
        "工作空间增量同步。dry_run=true（默认）仅生成 manifest 预览；预览后须继续 dry_run=false 实际同步。远程目录不存在时 dry_run 仍可成功，实际同步会自动 mkdir -p。",
      parameters: {
        type: "object",
        properties: {
          workspace_id: { type: "number" },
          dry_run: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_remote_file",
      description: "写入远程工作空间内文件（SFTP）",
      parameters: {
        type: "object",
        properties: {
          workspace_id: { type: "number" },
          remote_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["remote_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy",
      description: "工作空间部署：可选 sync + deploy_recipe 远程命令",
      parameters: {
        type: "object",
        properties: {
          workspace_id: { type: "number" },
          dry_run: { type: "boolean" },
          sync: { type: "boolean", description: "先同步，默认 true" },
          session_id: { type: "string" },
        },
      },
    },
  },
];

export const READ_TOOL_NAMES = new Set([
  "terminal_tail",
  "host_info",
  "list_hosts",
  "list_sessions",
  "host_metrics",
  "list_scripts",
  "get_script",
  "list_cmd_history",
  "create_inspection_report",
  "list_files",
  "read_file",
  "file_info",
  "ping",
  "dns_lookup",
  "tcp_probe",
  "tls_cert",
  "docker_ps",
  "docker_logs",
  "docker_inspect",
  "search_notes",
  "search_session_logs",
  "search_cmd_history",
  "port_snapshot",
  "disk_snapshot",
]);

export const WRITE_TOOL_NAMES = new Set([
  "terminal_run",
  "session_exec",
  "run_script",
  "run_batch",
  "docker_compose_up",
  "upload_file",
  "upload_tree",
  "sync_to_remote",
  "write_remote_file",
  "deploy",
]);
