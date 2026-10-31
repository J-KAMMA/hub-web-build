"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

import { cx } from "./cx";

/*
 * Tabs (SPEC 3): height 44, 15/600, unselected --muted, selected --text with a
 * 2px --emphasis underline the width of the label. A row that overflows fades its
 * clipped edge (data-fade-start / data-fade-end) instead of cutting a label. Roving arrow-key focus.
 * Items with href render links (navigation tabs, aria-current); items without
 * render role="tab" buttons driven by `value`/`onChange`.
 */
export type TabItem = { id: string; label: string; href?: string; count?: number };

export type TabsProps = {
  items: readonly TabItem[];
  value: string;
  label: string;
  onChange?: (id: string) => void;
  className?: string;
};

export function Tabs({ items, value, label, onChange, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /* 横にあふれるときだけ、あふれている側の端をぼかす（CSS の mask）。切れた文字を見せない。 */
  const syncFade = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    if (max <= 1) {
      node.removeAttribute("data-fade-start");
      node.removeAttribute("data-fade-end");
      return;
    }
    if (node.scrollLeft > 1) node.setAttribute("data-fade-start", ""); else node.removeAttribute("data-fade-start");
    if (node.scrollLeft < max - 1) node.setAttribute("data-fade-end", ""); else node.removeAttribute("data-fade-end");
  }, []);
  useEffect(() => {
    syncFade();
    const node = listRef.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncFade);
    observer.observe(node);
    return () => observer.disconnect();
  }, [syncFade, items.length, value]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-ui-tab]") ?? []);
    if (nodes.length === 0) return;
    const current = nodes.findIndex((node) => node === document.activeElement);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % nodes.length;
    if (event.key === "ArrowLeft") next = (current - 1 + nodes.length) % nodes.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = nodes.length - 1;
    event.preventDefault();
    nodes[next]?.focus();
  };
  return (
    <div ref={listRef} className={cx("ui-tabs", className)} role="tablist" aria-label={label} onKeyDown={move} onScroll={syncFade}>
      {items.map((item) => {
        const selected = item.id === value;
        const body = (
          <span className="ui-tab__label">
            {item.label}
            {item.count !== undefined ? <span className="ui-tab__count">{item.count}</span> : null}
          </span>
        );
        return item.href !== undefined ? (
          <Link key={item.id} data-ui-tab="" className="ui-tab" href={item.href} aria-current={selected ? "page" : undefined} data-selected={selected || undefined}>
            {body}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-ui-tab=""
            className="ui-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-selected={selected || undefined}
            onClick={() => onChange?.(item.id)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
