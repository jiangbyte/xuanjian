/**
 * @file 应用对话框（alert / confirm / prompt / choice）
 * @author Charlie
 * @description Promise 风格对话框队列，一次只展示一个。
 * 替代原生 window.alert/confirm；点击遮罩或 Escape 按类型 resolve。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

type AlertReq = {
  kind: "alert";
  title?: string;
  message: string;
  resolve: () => void;
};

type ConfirmReq = {
  kind: "confirm";
  title?: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};

type PromptReq = {
  kind: "prompt";
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
};

type ChoiceAction = {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
};

type ChoiceReq = {
  kind: "choice";
  title?: string;
  message: string;
  actions: ChoiceAction[];
  resolve: (id: string | null) => void;
};

type DialogReq = AlertReq | ConfirmReq | PromptReq | ChoiceReq;

/** 对话框 API：均返回 Promise，关闭后 resolve */
export type DialogApi = {
  alert: (message: string, opts?: { title?: string }) => Promise<void>;
  confirm: (
    message: string,
    opts?: {
      title?: string;
      danger?: boolean;
      confirmLabel?: string;
      cancelLabel?: string;
    },
  ) => Promise<boolean>;
  prompt: (
    message: string,
    opts?: { title?: string; defaultValue?: string; placeholder?: string },
  ) => Promise<string | null>;
  /** 多按钮对话框；返回 action id，取消则为 null */
  choice: (
    message: string,
    opts: { title?: string; actions: ChoiceAction[] },
  ) => Promise<string | null>;
};

const Ctx = createContext<DialogApi | null>(null);

/**
 * 读取对话框 API；须在 DialogProvider 内使用。
 * @throws 未包裹 Provider 时抛错
 */
export function useDialog() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useDialog requires DialogProvider");
  return api;
}

/**
 * 提供 alert/confirm/prompt/choice，内部用队列串行展示 DialogView。
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogReq[]>([]);
  const current = queue[0] ?? null;

  const enqueue = useCallback((req: DialogReq) => {
    setQueue((q) => [...q, req]);
  }, []);

  const finish = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      alert: (message, opts) =>
        new Promise<void>((resolve) => {
          enqueue({
            kind: "alert",
            message,
            title: opts?.title,
            resolve: () => {
              resolve();
              finish();
            },
          });
        }),
      confirm: (message, opts) =>
        new Promise<boolean>((resolve) => {
          enqueue({
            kind: "confirm",
            message,
            title: opts?.title,
            danger: opts?.danger,
            confirmLabel: opts?.confirmLabel,
            cancelLabel: opts?.cancelLabel,
            resolve: (ok) => {
              resolve(ok);
              finish();
            },
          });
        }),
      prompt: (message, opts) =>
        new Promise<string | null>((resolve) => {
          enqueue({
            kind: "prompt",
            message,
            title: opts?.title,
            defaultValue: opts?.defaultValue,
            placeholder: opts?.placeholder,
            resolve: (value) => {
              resolve(value);
              finish();
            },
          });
        }),
      choice: (message, opts) =>
        new Promise<string | null>((resolve) => {
          enqueue({
            kind: "choice",
            message,
            title: opts.title,
            actions: opts.actions,
            resolve: (id) => {
              resolve(id);
              finish();
            },
          });
        }),
    }),
    [enqueue, finish],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {current && <DialogView req={current} />}
    </Ctx.Provider>
  );
}

/** 单个对话框视图：键盘 Escape/Enter、遮罩关闭 */
function DialogView({ req }: { req: DialogReq }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(
    req.kind === "prompt" ? (req.defaultValue ?? "") : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (req.kind === "prompt") {
      setValue(req.defaultValue ?? "");
      const id = window.setTimeout(() => inputRef.current?.select(), 0);
      return () => window.clearTimeout(id);
    }
  }, [req]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (req.kind === "alert") req.resolve();
        else if (req.kind === "confirm") req.resolve(false);
        else if (req.kind === "choice") req.resolve(null);
        else req.resolve(null);
      }
      if (e.key === "Enter" && req.kind !== "prompt" && req.kind !== "choice") {
        if (req.kind === "alert") req.resolve();
        else if (req.kind === "confirm") req.resolve(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  const title =
    req.title ||
    (req.kind === "alert"
      ? t("dialog.alert")
      : req.kind === "confirm"
        ? t("dialog.confirm")
        : req.kind === "choice"
          ? t("dialog.confirm")
          : t("dialog.prompt"));

  const closeOverlay = () => {
    if (req.kind === "alert") req.resolve();
    else if (req.kind === "confirm") req.resolve(false);
    else if (req.kind === "choice") req.resolve(null);
    else req.resolve(null);
  };

  return createPortal(
    <div
      className="overlay z-[100] flex items-center justify-center p-4"
      onClick={closeOverlay}
    >
      <div
        className="modal-card w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <div className="border-b border-[var(--border)] px-5 py-3">
          <h3 id="app-dialog-title" className="text-sm font-semibold">
            {title}
          </h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {req.message}
          </p>
          {req.kind === "prompt" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                req.resolve(value);
              }}
            >
              <input
                ref={inputRef}
                className="field"
                value={value}
                placeholder={req.placeholder}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </form>
          )}
        </div>
        {/* —— 操作按钮 —— */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {req.kind === "choice" ? (
            <>
              <button className="btn" onClick={() => req.resolve(null)}>
                {t("dialog.cancel")}
              </button>
              {req.actions.map((action) => (
                <button
                  key={action.id}
                  className={`btn ${
                    action.danger
                      ? "btn-danger-fill"
                      : action.primary
                        ? "btn-primary"
                        : ""
                  }`}
                  onClick={() => req.resolve(action.id)}
                >
                  {action.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {req.kind !== "alert" && (
                <button
                  className="btn"
                  onClick={() => {
                    if (req.kind === "confirm") req.resolve(false);
                    else req.resolve(null);
                  }}
                >
                  {req.kind === "confirm" && req.cancelLabel
                    ? req.cancelLabel
                    : t("dialog.cancel")}
                </button>
              )}
              <button
                className={`btn ${
                  req.kind === "confirm" && req.danger
                    ? "btn-danger-fill"
                    : "btn-primary"
                }`}
                onClick={() => {
                  if (req.kind === "alert") req.resolve();
                  else if (req.kind === "confirm") req.resolve(true);
                  else req.resolve(value);
                }}
              >
                {req.kind === "confirm" && req.danger
                  ? t("dialog.delete")
                  : req.kind === "confirm" && req.confirmLabel
                    ? req.confirmLabel
                    : t("dialog.ok")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
