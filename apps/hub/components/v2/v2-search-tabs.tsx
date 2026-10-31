"use client";

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

export interface V2SearchTabItem<T extends string> {
  value: T;
  label: string;
  count?: number | null;
}

export interface V2SearchTabsProps<T extends string> {
  label: string;
  items: readonly V2SearchTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

function sameValues<T extends string>(left: readonly V2SearchTabItem<T>[], right: readonly T[]) {
  return left.length === right.length && left.every((item, index) => item.value === right[index]);
}

export function V2SearchTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: V2SearchTabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedValue, setFocusedValue] = useState<T | null>(null);
  const itemValues = items.map((item) => item.value);
  const previousValue = useRef(value);
  const previousValues = useRef(itemValues);
  const selectionChanged = previousValue.current !== value;
  const itemsChanged = !sameValues(items, previousValues.current);
  const selectedIsPresent = items.some((item) => item.value === value);
  const entryValue = selectedIsPresent ? value : (items[0]?.value ?? null);
  const focusedIsPresent = focusedValue !== null && items.some((item) => item.value === focusedValue);
  const rovingValue = !selectionChanged && !itemsChanged && focusedIsPresent
    ? focusedValue
    : entryValue;

  useEffect(() => {
    const valueChanged = previousValue.current !== value;
    const valuesChanged = !sameValues(items, previousValues.current);
    previousValue.current = value;
    previousValues.current = itemValues;
    if (valueChanged || valuesChanged) setFocusedValue(null);
  }, [itemValues, items, value]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nativeEvent = event.nativeEvent;
    if (
      event.defaultPrevented
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || nativeEvent.isComposing
      || nativeEvent.keyCode === 229
    ) return;

    let nextIndex = -1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    if (nextIndex < 0 || !items.length) return;

    const nextItem = items[nextIndex];
    if (!nextItem) return;
    event.preventDefault();
    setFocusedValue(nextItem.value);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && event.currentTarget.contains(relatedTarget as Node)) return;
    setFocusedValue(null);
  };

  return (
    <div
      className={className ?? "v2-search__groups"}
      role="tablist"
      aria-label={label}
      onBlur={handleBlur}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(node) => { tabRefs.current[index] = node; }}
          type="button"
          role="tab"
          className="v2-search__group"
          aria-selected={item.value === value}
          tabIndex={item.value === rovingValue ? 0 : -1}
          onFocus={() => setFocusedValue(item.value)}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {typeof item.count === "number" ? <span className="v2-search__group-count" aria-hidden="true">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
