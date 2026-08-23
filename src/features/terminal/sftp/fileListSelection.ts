/**
 * @file 文件列表多选（Windows 资源管理器风格）
 * @author Charlie
 */

import { useCallback, useMemo, useState } from "react";
import type { SftpEntry } from "@/lib/tauri";

export function useFileListSelection(visible: SftpEntry[]) {
  const [checked, setChecked] = useState<Record<string, SftpEntry>>({});
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);

  const checkedList = useMemo(() => Object.values(checked), [checked]);
  const allVisibleChecked =
    visible.length > 0 && visible.every((e) => checked[e.path]);

  const clearChecked = useCallback(() => {
    setChecked({});
    setAnchorPath(null);
    setFocusPath(null);
  }, []);

  const selectAllVisible = useCallback(() => {
    setChecked((prev) => {
      const next = { ...prev };
      visible.forEach((e) => {
        next[e.path] = e;
      });
      return next;
    });
    if (visible[0]) setAnchorPath(visible[0].path);
  }, [visible]);

  const toggleCheck = useCallback((entry: SftpEntry, value?: boolean) => {
    setChecked((prev) => {
      const next = { ...prev };
      const on = value ?? !next[entry.path];
      if (on) next[entry.path] = entry;
      else delete next[entry.path];
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    if (allVisibleChecked) clearChecked();
    else selectAllVisible();
  }, [allVisibleChecked, clearChecked, selectAllVisible]);

  const selectOnly = useCallback((entry: SftpEntry) => {
    setChecked({ [entry.path]: entry });
    setAnchorPath(entry.path);
    setFocusPath(entry.path);
  }, []);

  const selectMany = useCallback((entries: SftpEntry[], additive: boolean) => {
    setChecked((prev) => {
      const next = additive ? { ...prev } : {};
      for (const e of entries) next[e.path] = e;
      return next;
    });
    if (entries.length) {
      setAnchorPath(entries[0].path);
      setFocusPath(entries[entries.length - 1].path);
    }
  }, []);

  /** 单击行：无修饰键单选；Ctrl 切换；Shift 范围选 */
  const handleRowPointer = useCallback(
    (
      entry: SftpEntry,
      index: number,
      e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    ) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.shiftKey) {
        const anchorIdx =
          anchorPath != null
            ? visible.findIndex((x) => x.path === anchorPath)
            : -1;
        const start =
          anchorIdx >= 0 ? Math.min(anchorIdx, index) : index;
        const end =
          anchorIdx >= 0 ? Math.max(anchorIdx, index) : index;
        setChecked((prev) => {
          const next = mod ? { ...prev } : {};
          for (let i = start; i <= end; i++) {
            next[visible[i].path] = visible[i];
          }
          return next;
        });
        if (!mod) setAnchorPath(visible[start]?.path ?? entry.path);
      } else if (mod) {
        toggleCheck(entry);
        setAnchorPath(entry.path);
      } else {
        selectOnly(entry);
      }
      setFocusPath(entry.path);
    },
    [anchorPath, selectOnly, toggleCheck, visible],
  );

  const isSelected = useCallback(
    (entry: SftpEntry) => !!checked[entry.path],
    [checked],
  );

  return {
    checked,
    checkedList,
    focusPath,
    allVisibleChecked,
    toggleCheck,
    toggleAllVisible,
    selectAllVisible,
    clearChecked,
    selectOnly,
    selectMany,
    handleRowPointer,
    isSelected,
    setChecked,
    setFocusPath,
  };
}
