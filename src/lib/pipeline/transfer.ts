/**
 * @file Pipeline 跨端点文件传输
 * @author Charlie
 */

import { getHost } from "@/lib/db";
import { fsReadFile, fsWriteFile } from "@/lib/fs";
import { resolvePipelineEndpoint } from "@/lib/pipeline/endpoints";
import type { PipelineEndpoint } from "@/lib/pipeline/types";
import { api } from "@/lib/tauri";

function shQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}`;
}

/** 跨平面传输单文件 */
export async function pipelineTransferFile(
  source: PipelineEndpoint,
  target: PipelineEndpoint,
  fromPath: string,
  toPath: string,
  opts?: { preferScp?: boolean },
): Promise<{ method: string; bytes?: number }> {
  const src = await resolvePipelineEndpoint(source);
  const dst = await resolvePipelineEndpoint(target);

  const sameSession = src.sessionId === dst.sessionId;
  if (sameSession) {
    const cmd = `cp ${shQuote(fromPath)} ${shQuote(toPath)}`;
    await api.sessionExec(src.sessionId, cmd);
    return { method: "cp-same-session" };
  }

  const srcKind = source.kind;
  const dstKind = target.kind;

  // WSL / SSH → SSH：在源会话 scp
  if (
    opts?.preferScp ||
    (srcKind === "wsl" && dstKind === "ssh") ||
    (srcKind === "ssh" && dstKind === "ssh")
  ) {
    if (dstKind !== "ssh") {
      throw new Error("scp transfer requires SSH target");
    }
    const host = await getHost(target.host_id);
    if (!host) throw new Error(`Host #${target.host_id} not found`);
    const remote = `${host.username}@${host.host}:${toPath}`;
    const cmd = `scp -P ${host.port} ${shQuote(fromPath)} ${shQuote(remote)}`;
    await api.sessionExec(src.sessionId, cmd);
    return { method: "scp" };
  }

  // 本机 Windows → WSL：WSL 内 cp wslpath
  if (srcKind === "local" && dstKind === "wsl") {
    const win = fromPath.replace(/\\/g, "/");
    const cmd = `cp "$(wslpath -u ${shQuote(win)})" ${shQuote(toPath)}`;
    await api.sessionExec(dst.sessionId, cmd);
    return { method: "wslpath-cp" };
  }

  // WSL → 本机
  if (srcKind === "wsl" && dstKind === "local") {
    const win = toPath.replace(/\\/g, "/");
    const cmd = `cp ${shQuote(fromPath)} "$(wslpath -u ${shQuote(win)})"`;
    await api.sessionExec(src.sessionId, cmd);
    return { method: "wslpath-cp" };
  }

  // 本机 → SSH：读本地写 SFTP
  if (srcKind === "local" && dstKind === "ssh") {
    const content = await fsReadFile(src.endpoint, fromPath);
    await fsWriteFile(dst.endpoint, toPath, content);
    return { method: "read-write", bytes: content.length };
  }

  // WSL → SSH（非 scp 回退）
  if (srcKind === "wsl" && dstKind === "ssh") {
    const content = await fsReadFile(src.endpoint, fromPath);
    await fsWriteFile(dst.endpoint, toPath, content);
    return { method: "read-write", bytes: content.length };
  }

  // SSH → 本机 / WSL
  if (srcKind === "ssh" && (dstKind === "local" || dstKind === "wsl")) {
    const content = await fsReadFile(src.endpoint, fromPath);
    await fsWriteFile(dst.endpoint, toPath, content);
    return { method: "read-write", bytes: content.length };
  }

  // SSH → SSH（非 scp 回退：经本机中转）
  if (srcKind === "ssh" && dstKind === "ssh") {
    const content = await fsReadFile(src.endpoint, fromPath);
    await fsWriteFile(dst.endpoint, toPath, content);
    return { method: "relay-read-write", bytes: content.length };
  }

  throw new Error(
    `Unsupported transfer: ${srcKind} → ${dstKind}`,
  );
}
