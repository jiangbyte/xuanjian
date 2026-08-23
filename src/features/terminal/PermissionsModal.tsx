/**
 * @file 文件权限编辑模态框
 * @author Charlie
 * @description 以勾选位与八进制两种方式编辑 Unix 风格权限（rwx）。
 * 支持从符号串（如 rw-r--r--）或八进制（644）解析初值。
 * 应用时回调父组件传入的 onApply(mode)，由调用方执行 chmod。
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 单组读写执行位 */
type PermBits = { r: boolean; w: boolean; x: boolean };
/** 所有者 / 组 / 其他人 三组权限 */
type PermState = { owner: PermBits; group: PermBits; other: PermBits };

/** 从数字 mode 拆出 owner/group/other 位 */
function bitsFromMode(mode: number): PermState {
  const bit = (shift: number, mask: number) => ((mode >> shift) & mask) !== 0;
  return {
    owner: { r: bit(6, 4), w: bit(6, 2), x: bit(6, 1) },
    group: { r: bit(3, 4), w: bit(3, 2), x: bit(3, 1) },
    other: { r: bit(0, 4), w: bit(0, 2), x: bit(0, 1) },
  };
}

/** 将三组位打包为数字 mode */
function modeFromBits(state: PermState): number {
  const pack = (b: PermBits) => (b.r ? 4 : 0) | (b.w ? 2 : 0) | (b.x ? 1 : 0);
  return (
    (pack(state.owner) << 6) | (pack(state.group) << 3) | pack(state.other)
  );
}

/** 生成符号权限串，如 rw-r--r-- */
function symbolicFromBits(state: PermState): string {
  const one = (b: PermBits) =>
    `${b.r ? "r" : "-"}${b.w ? "w" : "-"}${b.x ? "x" : "-"}`;
  return `${one(state.owner)}${one(state.group)}${one(state.other)}`;
}

/** 解析初始权限：优先 9 位符号串，其次 3–4 位八进制，默认 0644 */
function parseInitial(permissions?: string | null): PermState {
  if (permissions && /^[rwx-]{9}$/.test(permissions)) {
    const c = permissions.split("");
    const one = (i: number): PermBits => ({
      r: c[i] === "r",
      w: c[i + 1] === "w",
      x: c[i + 2] === "x",
    });
    return { owner: one(0), group: one(3), other: one(6) };
  }
  if (permissions && /^[0-7]{3,4}$/.test(permissions)) {
    return bitsFromMode(Number.parseInt(permissions, 8));
  }
  return bitsFromMode(0o644);
}

/**
 * 权限编辑弹层：勾选位与八进制双向同步，确认后调用 onApply。
 */
export function PermissionsModal({
  path,
  permissions,
  onClose,
  onApply,
}: {
  path: string;
  permissions?: string | null;
  onClose: () => void;
  onApply: (mode: number) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const name =
    path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
  const [state, setState] = useState<PermState>(() =>
    parseInitial(permissions),
  );
  const [octalInput, setOctalInput] = useState(() =>
    modeFromBits(parseInitial(permissions)).toString(8).padStart(3, "0"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = useMemo(() => modeFromBits(state), [state]);
  const symbolic = useMemo(() => symbolicFromBits(state), [state]);

  const syncFromState = (next: PermState) => {
    setState(next);
    setOctalInput(modeFromBits(next).toString(8).padStart(3, "0"));
  };

  const toggle = (who: keyof PermState, bit: keyof PermBits) => {
    syncFromState({
      ...state,
      [who]: { ...state[who], [bit]: !state[who][bit] },
    });
  };

  const applyOctal = (raw: string) => {
    setOctalInput(raw);
    if (!/^[0-7]{3,4}$/.test(raw.trim())) return;
    syncFromState(bitsFromMode(Number.parseInt(raw.trim(), 8)));
  };

  const roles: { key: keyof PermState; label: string }[] = [
    { key: "owner", label: t("perms.owner") },
    { key: "group", label: t("perms.group") },
    { key: "other", label: t("perms.other") },
  ];

  const flags: { key: keyof PermBits; label: string }[] = [
    { key: "r", label: t("perms.read") },
    { key: "w", label: t("perms.write") },
    { key: "x", label: t("perms.exec") },
  ];

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("perms.title")}</DialogTitle>
          <p className="truncate text-xs text-muted-foreground" title={path}>
            {name}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="perm-octal">{t("perms.octal")}</Label>
            <div className="relative">
              <Input
                id="perm-octal"
                value={octalInput}
                maxLength={4}
                className="pr-24 font-mono"
                onChange={(e) =>
                  applyOctal(e.target.value.replace(/[^0-7]/g, ""))
                }
              />
              <Badge
                variant="secondary"
                className="absolute top-1/2 right-2 -translate-y-1/2 font-mono"
              >
                {symbolic}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            {roles.map((role) => (
              <div
                key={role.key}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5"
              >
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  {role.label}
                </span>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {flags.map((flag) => {
                    const on = state[role.key][flag.key];
                    return (
                      <Button
                        key={flag.key}
                        type="button"
                        size="xs"
                        variant={on ? "default" : "outline"}
                        onClick={() => toggle(role.key, flag.key)}
                      >
                        {flag.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            {t("hosts.cancel")}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onApply(mode);
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("perms.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
