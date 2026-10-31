"use client";

import { useEffect, useRef, useState } from "react";

export interface AppPickerOption<T extends string> {
  value: T;
  label: string;
}

interface AppPickerProps<T extends string> {
  label: string;
  value: T;
  options: AppPickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
  minWidth?: number;
}

export function AppPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  compact = false,
  minWidth
}: AppPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div
      className={`app-picker${compact ? " app-picker--compact" : ""}`}
      ref={rootRef}
      style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
    >
      <button
        type="button"
        className={`app-picker__button${open ? " app-picker__button--open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="app-picker__label">{label}</span>
        <span className="app-picker__value">{selected?.label ?? ""}</span>
        <span className="app-picker__chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="app-picker__menu" role="listbox" aria-label={label}>
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                className={`app-picker__option${active ? " app-picker__option--active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
