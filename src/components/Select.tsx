import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

export function Select({
  value,
  options,
  onChange,
  className = "",
  disabled,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? options[0],
    [options, value],
  );

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(240, Math.max(120, preferBelow ? spaceBelow : spaceAbove));
    setPos({
      top: preferBelow ? rect.bottom + 4 : Math.max(8, rect.top - maxHeight - 4),
      left: rect.left,
      width: Math.max(rect.width, 140),
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={`select ${open ? "is-open" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger field"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="select-value truncate">{selected?.label ?? ""}</span>
        <span className="select-caret" aria-hidden />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={menuRef}
            id={listId}
            className="select-menu"
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`select-option ${active ? "is-selected" : ""}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
