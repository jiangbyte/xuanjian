/**
 * @file 工具名中文标签
 */

export function toolLabel(name: string, args: unknown): string {
  if (
    (name === "terminal_run" || name === "session_exec") &&
    args &&
    typeof args === "object" &&
    "command" in args
  ) {
    return `${name === "terminal_run" ? "终端执行" : "旁路执行"} · ${String((args as { command: string }).command)}`;
  }
  if (name === "run_script" && args && typeof args === "object") {
    const a = args as { script_name?: string; script_id?: number };
    const title =
      a.script_name || (a.script_id != null ? `#${a.script_id}` : "");
    return title ? `执行脚本 · ${title}` : "执行脚本";
  }
  if (
    name === "get_script" &&
    args &&
    typeof args === "object" &&
    "script_id" in args
  ) {
    return `读取脚本 · #${String((args as { script_id: unknown }).script_id)}`;
  }
  const labels: Record<string, string> = {
    terminal_tail: "读取终端输出",
    list_sessions: "列出会话",
    host_info: "主机信息",
    list_hosts: "主机列表",
    host_metrics: "指标探测",
    run_batch: "批量执行脚本",
    create_inspection_report: "生成巡检报告",
    docker_compose_up: "Compose up",
    list_scripts: "脚本库列表",
    get_script: "读取脚本",
    list_cmd_history: "历史命令",
    run_script: "执行脚本",
    list_files: "列出文件",
    read_file: "读取文件",
    file_info: "文件信息",
    ping: "Ping",
    dns_lookup: "DNS 查询",
    tcp_probe: "TCP 探测",
    tls_cert: "TLS 证书",
    docker_ps: "Docker 列表",
    docker_logs: "Docker 日志",
    docker_inspect: "Docker Inspect",
    search_notes: "搜索笔记",
    search_session_logs: "搜索录制",
    search_cmd_history: "搜索历史命令",
    port_snapshot: "端口快照",
    disk_snapshot: "磁盘快照",
    upload_file: "上传文件",
    upload_tree: "上传目录树",
    sync_to_remote: "同步到远程",
    write_remote_file: "写远程文件",
    deploy: "部署",
  };
  return labels[name] ?? name;
}
