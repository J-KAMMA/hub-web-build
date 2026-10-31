"use client";

import { useRef, type KeyboardEvent } from "react";

import { cx } from "./cx";

/*
 * Segmented control (SPEC 3): up to three options, height 32, hairline dividers.
 * A radiogroup with roving tabindex; arrow keys move and select.
 */
export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
};

export function Segmented<T extends string>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  };
  return (
    <div ref={ref} className={cx("ui-segmented", className)} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-value={option.value}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={cx("ui-segmented__item", selected && "ui-segmented__item--selected")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
