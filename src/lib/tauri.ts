/**
 * @file Tauri 后端 API 与事件封装
 * @author Charlie
 * @description 统一 invoke 会话 / SFTP / 本地文件 / 网络工具命令，
 * 并提供 session-output、传输进度、网络工具输出等事件监听辅助函数。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/** 本机可用 Shell 信息 */
export type LocalShellInfo = {
  id: string;
  name: string;
  path: string;
  args: string[];
  isDefault: boolean;
};

/** 已打开的会话摘要 */
export type SessionInfo = {
  id: string;
  kind: "local" | "ssh";
  title: string;
};

/** SFTP / 本地目录条目 */
export type SftpEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt?: string | null;
  permissions?: string | null;
};

/** SSH 连接参数 */
export type SshConnectParams = {
  host: string;
  port: number;
  username: string;
  authType: string;
  password?: string | null;
  privateKeyPath?: string | null;
  passphrase?: string | null;
  title?: string;
  cols?: number;
  rows?: number;
  terminalType?: string | null;
};

/** 面向前端的 Tauri 命令集合 */
export const api = {
  listLocalShells: () => invoke<LocalShellInfo[]>("list_local_shells"),
  localShellOpen: (shellId: string, cols?: number, rows?: number) =>
    invoke<SessionInfo>("local_shell_open", { shellId, cols, rows }),
  sshConnect: (params: SshConnectParams) =>
    invoke<SessionInfo>("ssh_connect", { params }),
  sessionWrite: (sessionId: string, data: string) =>
    invoke("session_write", { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number) =>
    invoke("session_resize", { sessionId, cols, rows }),
  sessionClose: (sessionId: string) => invoke("session_close", { sessionId }),
  sessionExec: (sessionId: string, command: string) =>
    invoke<string>("session_exec", { sessionId, command }),
  sftpList: (sessionId: string, path: string) =>
    invoke<SftpEntry[]>("sftp_list", { sessionId, path }),
  sftpUpload: (
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId?: string | null,
    resumeFrom?: number | null,
  ) =>
    invoke("sftp_upload", {
      sessionId,
      localPath,
      remotePath,
      transferId: transferId ?? null,
      resumeFrom: resumeFrom ?? null,
    }),
  sftpDownload: (
    sessionId: string,
    remotePath: string,
    localPath: string,
    transferId?: string | null,
    resumeFrom?: number | null,
  ) =>
    invoke("sftp_download", {
      sessionId,
      remotePath,
      localPath,
      transferId: transferId ?? null,
      resumeFrom: resumeFrom ?? null,
    }),
  sftpTransferCancel: (transferId: string, pause?: boolean) =>
    invoke("sftp_transfer_cancel", {
      transferId,
      pause: pause ?? false,
    }),
  sftpRemove: (sessionId: string, path: string, isDir: boolean) =>
    invoke("sftp_remove", { sessionId, path, isDir }),
  sftpMkdir: (sessionId: string, path: string) =>
    invoke("sftp_mkdir", { sessionId, path }),
  sftpRead: (sessionId: string, path: string) =>
    invoke<string>("sftp_read", { sessionId, path }),
  sftpWrite: (sessionId: string, path: string, content: string) =>
    invoke("sftp_write", { sessionId, path, content }),
  sftpRename: (sessionId: string, oldPath: string, newPath: string) =>
    invoke("sftp_rename", { sessionId, oldPath, newPath }),
  sftpChmod: (sessionId: string, path: string, mode: number) =>
    invoke("sftp_chmod", { sessionId, path, mode }),
  encryptSecret: (plain: string) => invoke<string>("encrypt_secret", { plain }),
  getHomeDir: () => invoke<string>("get_home_dir"),
  getTempDir: () => invoke<string>("get_temp_dir"),
  listLocalDir: (path: string) =>
    invoke<SftpEntry[]>("list_local_dir", { path }),
  createLocalDir: (path: string) => invoke("create_local_dir", { path }),
  readLocalFile: (path: string) => invoke<string>("read_local_file", { path }),
  writeLocalFile: (path: string, content: string) =>
    invoke("write_local_file", { path, content }),
  renameLocalPath: (oldPath: string, newPath: string) =>
    invoke("rename_local_path", { oldPath, newPath }),
  chmodLocalPath: (path: string, mode: number) =>
    invoke("chmod_local_path", { path, mode }),
  removeLocalPath: (path: string) => invoke("remove_local_path", { path }),

  // —— 网络工具 ——
  networkListInterfaces: () =>
    invoke<NetInterface[]>("network_list_interfaces"),
  networkPing: (target: string, count?: number) =>
    invoke<string>("network_ping", { target, count: count ?? null }),
  networkTraceroute: (target: string) =>
    invoke<string>("network_traceroute", { target }),
  networkDnsLookup: (host: string, recordType: string) =>
    invoke<string>("network_dns_lookup", { host, recordType }),
  networkTcpProbe: (host: string, ports: number[], timeoutMs?: number) =>
    invoke<TcpProbeResult[]>("network_tcp_probe", {
      host,
      ports,
      timeoutMs: timeoutMs ?? null,
    }),
  networkCancel: (jobId: string) => invoke("network_cancel", { jobId }),
  networkDetectCaptureTools: () =>
    invoke<CaptureTools>("network_detect_capture_tools"),
  networkCaptureStart: (
    iface: string,
    filter: string | null,
    outputPath: string,
  ) =>
    invoke<string>("network_capture_start", {
      iface,
      filter,
      outputPath,
    }),
  networkCaptureStop: (jobId: string) =>
    invoke("network_capture_stop", { jobId }),
  networkPcapSummary: (path: string) =>
    invoke<PcapSummary>("network_pcap_summary", { path }),
  networkHttpRequest: (input: {
    method: string;
    url: string;
    headers: [string, string][];
    body?: string | null;
    followRedirect?: boolean;
  }) =>
    invoke<HttpResponse>("network_http_request", {
      method: input.method,
      url: input.url,
      headers: input.headers,
      body: input.body ?? null,
      followRedirect: input.followRedirect ?? true,
    }),
  networkTlsCert: (hostPort: string) =>
    invoke<TlsCertInfo>("network_tls_cert", { hostPort }),
  networkWhois: (query: string) => invoke<string>("network_whois", { query }),
};

export type NetInterface = { name: string; addrs: string[] };
export type TcpProbeResult = {
  host: string;
  port: number;
  open: boolean;
  latencyMs?: number | null;
  error?: string | null;
};
export type CaptureTools = {
  tshark?: string | null;
  dumpcap?: string | null;
  wireshark?: string | null;
};
export type PcapSummary = {
  packetCount: number;
  protocols: { name: string; count: number }[];
  sessions: {
    src: string;
    dst: string;
    protocol: string;
    packets: number;
  }[];
};
export type HttpResponse = {
  status: number;
  headers: [string, string][];
  body: string;
  elapsedMs: number;
};
export type TlsCertInfo = {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  san: string[];
  raw: string;
};

/** 监听会话标准输出事件 */
export function onSessionOutput(
  cb: (payload: { sessionId: string; data: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; data: string }>("session-output", (e) =>
    cb(e.payload),
  );
}

/** 监听会话关闭事件 */
export function onSessionClosed(
  cb: (payload: { sessionId: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string }>("session-closed", (e) => cb(e.payload));
}

/** 监听 SFTP 传输进度事件 */
export function onTransferProgress(
  cb: (payload: {
    transferId: string;
    bytesDone: number;
    bytesTotal: number;
  }) => void,
): Promise<UnlistenFn> {
  return listen<{
    transferId: string;
    bytesDone: number;
    bytesTotal: number;
  }>("sftp-transfer-progress", (e) => cb(e.payload));
}

/** 监听网络工具（ping / traceroute 等）流式输出 */
export function onNetworkToolOutput(
  cb: (payload: { jobId: string; line: string; done: boolean }) => void,
): Promise<UnlistenFn> {
  return listen<{ jobId: string; line: string; done: boolean }>(
    "network-tool-output",
    (e) => cb(e.payload),
  );
}
