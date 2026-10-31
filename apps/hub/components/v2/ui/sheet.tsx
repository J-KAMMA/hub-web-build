"use client";

import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cx } from "./cx";

/*
 * Dialog / sheet (SPEC 3). One component: a centred dialog on desktop (max 560,
 * --radius-lg, --elevation-2) and a bottom sheet on narrow screens (--radius-xl,
 * 36 x 5 grabber). Closes on Esc, backdrop press, or a downward swipe on the
 * grabber. Focus moves in on open, is trapped while open, and returns to the
 * element that opened it. Body scroll is locked while open.
 */
export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Hide the visible title row but keep it as the accessible name. */
  hideTitle?: boolean;
  className?: string;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, children, hideTitle = false, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const drag = useRef<{ y: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const head = nodes[0];
      const tail = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === head || document.activeElement === panel)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.style.overflow = previousOverflow;
      returnRef.current?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const onGrabDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onGrabUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (start && event.clientY - start.y > 72) onClose();
  };

  return createPortal(
    <div className="ui-sheet-root">
      <div className="ui-sheet-backdrop" data-testid="ui-sheet-backdrop" onPointerDown={onClose} />
      <div
        ref={panelRef}
        className={cx("ui-sheet", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ui-sheet__grab" aria-hidden="true" onPointerDown={onGrabDown} onPointerUp={onGrabUp} />
        <h2 id={titleId} className={cx("ui-sheet__title", hideTitle && "ui-sr")}>{title}</h2>
        <div className="ui-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
