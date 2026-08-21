import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

type PermBits = { r: boolean; w: boolean; x: boolean };
type PermState = { owner: PermBits; group: PermBits; other: PermBits };

function bitsFromMode(mode: number): PermState {
  const bit = (shift: number, mask: number) => ((mode >> shift) & mask) !== 0;
  return {
    owner: { r: bit(6, 4), w: bit(6, 2), x: bit(6, 1) },
    group: { r: bit(3, 4), w: bit(3, 2), x: bit(3, 1) },
    other: { r: bit(0, 4), w: bit(0, 2), x: bit(0, 1) },
  };
}

function modeFromBits(state: PermState): number {
  const pack = (b: PermBits) => (b.r ? 4 : 0) | (b.w ? 2 : 0) | (b.x ? 1 : 0);
  return (pack(state.owner) << 6) | (pack(state.group) << 3) | pack(state.other);
}

function symbolicFromBits(state: PermState): string {
  const one = (b: PermBits) =>
    `${b.r ? "r" : "-"}${b.w ? "w" : "-"}${b.x ? "x" : "-"}`;
  return `${one(state.owner)}${one(state.group)}${one(state.other)}`;
}

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
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
  const [state, setState] = useState<PermState>(() => parseInitial(permissions));
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
    <div className="overlay z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="modal-card flex w-full max-w-md flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("perms.title")}</div>
            <div className="truncate text-xs muted" title={path}>
              {name}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <label className="field-label">
            {t("perms.octal")}
            <div className="flex items-center gap-2">
              <input
                className="field font-mono"
                value={octalInput}
                maxLength={4}
                onChange={(e) => applyOctal(e.target.value.replace(/[^0-7]/g, ""))}
              />
              <span className="chip chip-accent font-mono">{symbolic}</span>
            </div>
          </label>

          <div className="flex flex-col gap-2">
            {roles.map((role) => (
              <div
                key={role.key}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5"
              >
                <span className="w-14 shrink-0 text-xs muted">{role.label}</span>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {flags.map((flag) => {
                    const on = state[role.key][flag.key];
                    return (
                      <button
                        key={flag.key}
                        type="button"
                        className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => toggle(role.key, flag.key)}
                      >
                        {flag.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && <div className="text-xs text-danger">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button className="btn" onClick={onClose} disabled={saving}>
            {t("hosts.cancel")}
          </button>
          <button
            className="btn btn-primary"
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
            {t("perms.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
