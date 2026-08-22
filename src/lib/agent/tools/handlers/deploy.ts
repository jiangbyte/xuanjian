/**
 * @file Agent 部署写工具处理器（M3）
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import {
  activeSessionId,
} from "@/lib/agent/tools/helpers";
import { asNum } from "@/lib/agent/tools/types";
import { getScript } from "@/lib/db";
import { parseDeployRecipe } from "@/lib/db/workspaces";
import {
  resolveActiveWorkspace,
} from "@/lib/workspace/context";
import {
  mapLocalToRemote,
  sandboxLocalPath,
  sandboxRemotePath,
} from "@/lib/workspace/pathSandbox";
import {
  applySyncManifest,
  buildSyncManifest,
} from "@/lib/workspace/syncEngine";
import { resolveWorkspaceFsEndpoint } from "@/lib/workspace/context";
import { fsWriteFile } from "@/lib/fs";
import { api } from "@/lib/tauri";
import { enqueueUpload } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

async function requireWorkspace(workspaceId?: number | null) {
  const ws = await resolveActiveWorkspace(workspaceId ?? undefined);
  if (!ws) {
    return {
      ok: false as const,
      error: "No active workspace; bind one in Workspace Switcher",
    };
  }
  return { ok: true as const, ws };
}

export async function runDeployToolHandler(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  switch (name) {
    case "upload_file": {
      const wsRes = await requireWorkspace(asNum(args.workspace_id));
      if (!wsRes.ok) return JSON.stringify(wsRes);
      const { ws } = wsRes;
      const localIn =
        typeof args.local_path === "string" ? args.local_path.trim() : "";
      const remoteIn =
        typeof args.remote_path === "string" ? args.remote_path.trim() : "";
      if (!localIn) {
        return JSON.stringify({ ok: false, error: "local_path required" });
      }
      const local = sandboxLocalPath(ws, localIn);
      if (!local.ok) return JSON.stringify({ ok: false, error: local.error });
      const remoteAbs = remoteIn
        ? sandboxRemotePath(ws, remoteIn)
        : { ok: true as const, abs: mapLocalToRemote(ws, local.abs) };
      if (!remoteAbs.ok) {
        return JSON.stringify({ ok: false, error: remoteAbs.error });
      }
      const sessionId = resolveWorkspaceFsEndpoint(ws)?.sessionId;
      if (!sessionId) {
        return JSON.stringify({
          ok: false,
          error: "SSH session required for remote upload",
        });
      }
      const jobId = enqueueUpload(sessionId, local.abs, remoteAbs.abs);
      useUiStore.getState().setTransferOpen(true);
      return JSON.stringify({
        ok: true,
        jobId,
        local_path: local.abs,
        remote_path: remoteAbs.abs,
      });
    }
    case "upload_tree": {
      const wsRes = await requireWorkspace(asNum(args.workspace_id));
      if (!wsRes.ok) return JSON.stringify(wsRes);
      const { ws } = wsRes;
      const sub =
        typeof args.local_subpath === "string" ? args.local_subpath.trim() : ".";
      const local = sandboxLocalPath(ws, sub);
      if (!local.ok) return JSON.stringify({ ok: false, error: local.error });
      const manifest = await buildSyncManifest(ws, { dryRun: true });
      const prefix = sub === "." ? "" : `${sub.replace(/\\/g, "/").replace(/\/$/, "")}/`;
      const filtered = manifest.entries.filter(
        (e) => e.action === "upload" && (!prefix || e.relPath.startsWith(prefix)),
      );
      const applyManifest = {
        ...manifest,
        entries: filtered,
        uploadCount: filtered.length,
        skipCount: 0,
        dryRun: false,
      };
      const { enqueued, jobIds } = await applySyncManifest(ws, applyManifest);
      if (enqueued > 0) useUiStore.getState().setTransferOpen(true);
      return JSON.stringify({
        ok: true,
        enqueued,
        jobIds,
        subpath: sub,
      });
    }
    case "sync_to_remote": {
      const wsRes = await requireWorkspace(asNum(args.workspace_id));
      if (!wsRes.ok) return JSON.stringify(wsRes);
      const { ws } = wsRes;
      const dryRun = args.dry_run !== false;
      const manifest = await buildSyncManifest(ws, { dryRun });
      if (dryRun) {
        return JSON.stringify(manifest, null, 2);
      }
      const { enqueued, jobIds } = await applySyncManifest(ws, manifest);
      if (enqueued > 0) useUiStore.getState().setTransferOpen(true);
      return JSON.stringify({
        ok: true,
        enqueued,
        jobIds,
        uploadCount: manifest.uploadCount,
      });
    }
    case "write_remote_file": {
      const wsRes = await requireWorkspace(asNum(args.workspace_id));
      if (!wsRes.ok) return JSON.stringify(wsRes);
      const { ws } = wsRes;
      const remoteIn =
        typeof args.remote_path === "string" ? args.remote_path.trim() : "";
      if (!remoteIn) {
        return JSON.stringify({ ok: false, error: "remote_path required" });
      }
      const remote = sandboxRemotePath(ws, remoteIn);
      if (!remote.ok) return JSON.stringify({ ok: false, error: remote.error });
      const content =
        typeof args.content === "string" ? args.content : "";
      const ep = resolveWorkspaceFsEndpoint(ws);
      if (!ep?.sessionId || ep.kind !== "sftp") {
        return JSON.stringify({
          ok: false,
          error: "SSH SFTP session required",
        });
      }
      await fsWriteFile(ep, remote.abs, content);
      return JSON.stringify({
        ok: true,
        remote_path: remote.abs,
        bytes: content.length,
      });
    }
    case "deploy": {
      const wsRes = await requireWorkspace(asNum(args.workspace_id));
      if (!wsRes.ok) return JSON.stringify(wsRes);
      const { ws } = wsRes;
      const dryRun = args.dry_run === true;
      const syncFirst = args.sync !== false;
      const sid = activeSessionId(
        typeof args.session_id === "string" ? args.session_id : undefined,
      ) ?? resolveWorkspaceFsEndpoint(ws)?.sessionId;
      if (!sid) {
        return JSON.stringify({ ok: false, error: "No active session" });
      }

      const steps = parseDeployRecipe(ws.deploy_recipe);
      const manifest = syncFirst
        ? await buildSyncManifest(ws, { dryRun: true })
        : null;

      if (dryRun) {
        return JSON.stringify(
          {
            ok: true,
            dry_run: true,
            workspace_id: ws.id,
            sync: manifest,
            recipe_steps: steps,
          },
          null,
          2,
        );
      }

      let syncResult: { enqueued: number; jobIds: string[] } | null = null;
      if (syncFirst && manifest && manifest.uploadCount > 0) {
        syncResult = await applySyncManifest(ws, {
          ...manifest,
          dryRun: false,
        });
        if (syncResult.enqueued > 0) {
          useUiStore.getState().setTransferOpen(true);
        }
      }

      const outputs: Array<{ step: number; command?: string; output: string }> =
        [];
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        if (step.script_id != null) {
          const script = await getScript(step.script_id);
          if (!script) {
            outputs.push({
              step: i + 1,
              output: `script ${step.script_id} not found`,
            });
            continue;
          }
          const out = await api.sessionExec(sid, script.body);
          outputs.push({
            step: i + 1,
            command: script.name,
            output: stripAnsi(out.slice(0, 8000)),
          });
          continue;
        }
        if (step.command?.trim()) {
          const out = await api.sessionExec(sid, step.command.trim());
          outputs.push({
            step: i + 1,
            command: step.command.trim(),
            output: stripAnsi(out.slice(0, 8000)),
          });
        }
      }

      return JSON.stringify(
        {
          ok: true,
          workspace_id: ws.id,
          sync: syncResult,
          steps: outputs,
        },
        null,
        2,
      );
    }
    default:
      return null;
  }
}

export function isDryRunAllowedInPlan(name: string, args: Record<string, unknown>) {
  if (name === "sync_to_remote" && args.dry_run !== false) return true;
  if (name === "deploy" && args.dry_run === true) return true;
  return false;
}
