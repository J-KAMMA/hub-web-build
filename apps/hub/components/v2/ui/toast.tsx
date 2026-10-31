"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Toast (SPEC 3): bottom centre, --material-sheet pill, 44 high, 4 seconds, at
 * most one undo action. Replaces ad-hoc notices for like failures, saves, copies.
 * Wrap the app (or a screen) in <ToastProvider>; call useToast().show(...).
 * The region is a polite live region so screen readers hear each message once.
 */
export type ToastAction = { label: string; onAction: () => void };
export type ToastInput = { message: string; action?: ToastAction; durationMs?: number };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null);

export const TOAST_DEFAULT_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = next.current++;
      setItems((current) => [...current.slice(-2), { ...toast, id }]);
      timers.current.set(id, setTimeout(() => dismiss(id), toast.durationMs ?? TOAST_DEFAULT_MS));
    },
    [dismiss],
  );

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="ui-toast">
            <span className="ui-toast__message">{item.message}</span>
            {item.action ? (
              <button
                type="button"
                className="ui-toast__action"
                onClick={() => {
                  item.action?.onAction();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* Safe without a provider: show() is a no-op so a screen rendered outside the v2 shell (tests, embeds) never throws. */
const NO_TOAST = { show: (_toast: ToastInput) => {} };

export function useToast() {
  return useContext(ToastContext) ?? NO_TOAST;
}
