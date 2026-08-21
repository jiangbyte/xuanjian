/**
 * @file Promise 对话框（shadcn AlertDialog / Dialog）
 * @author Charlie
 * @description 命令式 API；由 DialogHost 渲染。
 */

import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import i18n from "@/i18n";

export type DialogChoiceAction = {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
};

type DialogRequest =
  | {
      kind: "alert";
      title: string;
      message: string;
      resolve: () => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      danger?: boolean;
      confirmLabel: string;
      cancelLabel: string;
      resolve: (v: boolean) => void;
    }
  | {
      kind: "prompt";
      title: string;
      message: string;
      defaultValue: string;
      placeholder?: string;
      resolve: (v: string | null) => void;
    }
  | {
      kind: "choice";
      title: string;
      message: string;
      actions: DialogChoiceAction[];
      resolve: (v: string | null) => void;
    };

type DialogStore = {
  current: DialogRequest | null;
  enqueue: (req: DialogRequest) => void;
  clear: () => void;
};

const useDialogStore = create<DialogStore>((set) => ({
  current: null,
  enqueue: (req) => set({ current: req }),
  clear: () => set({ current: null }),
}));

function settleAndClear(run: () => void) {
  useDialogStore.getState().clear();
  run();
}

/** 提示框 */
export function dialogAlert(
  message: string,
  opts?: { title?: string },
): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({
      kind: "alert",
      title: opts?.title ?? i18n.t("dialog.alert"),
      message,
      resolve,
    });
  });
}

/** 确认框；true=确认 */
export function dialogConfirm(
  message: string,
  opts?: {
    title?: string;
    danger?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({
      kind: "confirm",
      title: opts?.title ?? i18n.t("dialog.confirm"),
      message,
      danger: opts?.danger,
      confirmLabel:
        opts?.confirmLabel ??
        (opts?.danger ? i18n.t("dialog.delete") : i18n.t("dialog.ok")),
      cancelLabel: opts?.cancelLabel ?? i18n.t("dialog.cancel"),
      resolve,
    });
  });
}

/** 输入框；取消返回 null */
export function dialogPrompt(
  message: string,
  opts?: { title?: string; defaultValue?: string; placeholder?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({
      kind: "prompt",
      title: opts?.title ?? i18n.t("dialog.prompt"),
      message,
      defaultValue: opts?.defaultValue ?? "",
      placeholder: opts?.placeholder,
      resolve,
    });
  });
}

/** 多按钮选择；取消返回 null */
export function dialogChoice(
  message: string,
  opts: { title?: string; actions: DialogChoiceAction[] },
): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().enqueue({
      kind: "choice",
      title: opts.title ?? i18n.t("dialog.confirm"),
      message,
      actions: opts.actions,
      resolve,
    });
  });
}

export type DialogApi = {
  alert: typeof dialogAlert;
  confirm: typeof dialogConfirm;
  prompt: typeof dialogPrompt;
  choice: typeof dialogChoice;
};

export const dialogs: DialogApi = {
  alert: dialogAlert,
  confirm: dialogConfirm,
  prompt: dialogPrompt,
  choice: dialogChoice,
};

/** 挂在应用根；渲染当前对话框 */
export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const [promptValue, setPromptValue] = useState("");

  useEffect(() => {
    if (current?.kind === "prompt") {
      setPromptValue(current.defaultValue);
    }
  }, [current]);

  if (!current) return null;

  if (current.kind === "alert") {
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) settleAndClear(() => current.resolve());
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {current.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => settleAndClear(() => current.resolve())}
            >
              {i18n.t("dialog.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (current.kind === "confirm") {
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) settleAndClear(() => current.resolve(false));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {current.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => settleAndClear(() => current.resolve(false))}
            >
              {current.cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                current.danger
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => settleAndClear(() => current.resolve(true))}
            >
              {current.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (current.kind === "prompt") {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) settleAndClear(() => current.resolve(null));
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {current.message}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={promptValue}
            placeholder={current.placeholder}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                settleAndClear(() => current.resolve(promptValue));
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => settleAndClear(() => current.resolve(null))}
            >
              {i18n.t("dialog.cancel")}
            </Button>
            <Button
              onClick={() => settleAndClear(() => current.resolve(promptValue))}
            >
              {i18n.t("dialog.ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) settleAndClear(() => current.resolve(null));
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {current.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => settleAndClear(() => current.resolve(null))}
          >
            {i18n.t("dialog.cancel")}
          </Button>
          {current.actions.map((action) => (
            <Button
              key={action.id}
              variant={
                action.danger
                  ? "destructive"
                  : action.primary
                    ? "default"
                    : "outline"
              }
              onClick={() => settleAndClear(() => current.resolve(action.id))}
            >
              {action.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
