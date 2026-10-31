"use client";

import { useEffect, useRef, useState } from "react";

export function useColumnWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial);
  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved > 0) setWidth(Math.min(max, Math.max(min, Math.round(saved))));
    } catch {}
  }, [key, min, max]);
  const resize = (value: number) => {
    const next = clamp(value);
    setWidth(next);
    try { localStorage.setItem(key, String(next)); } catch {}
  };
  return [width, resize] as const;
}

export function V2ColumnResize({ label, width, initial, min, max, onChange }: {
  label: string; width: number; initial: number; min: number; max: number; onChange: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return <div className="v2-column-resizer" role="separator" tabIndex={0}
    aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current) onChange(drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onChange(initial)}
    onKeyDown={event => {
      const next = event.key === "ArrowLeft" ? width - 16 : event.key === "ArrowRight" ? width + 16
        : event.key === "Home" ? initial : null;
      if (next === null) return;
      event.preventDefault();
      onChange(next);
    }} />;
}
