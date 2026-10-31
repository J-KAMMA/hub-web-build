"use client";

import React, { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type HorizontalScrollRailProps = {
  children: ReactNode;
  label: string;
  className?: string;
  viewportClassName?: string;
  buttonClassName?: string;
  scrollAmount?: number;
};

export function HorizontalScrollRail({
  children,
  label,
  className = "",
  viewportClassName = "",
  buttonClassName = "",
  scrollAmount = 280,
}: HorizontalScrollRailProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, moved: false });
  const [edges, setEdges] = useState({ start: true, end: true });

  const updateEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setEdges({ start: viewport.scrollLeft <= 1, end: viewport.scrollLeft >= max - 1 });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateEdges();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    for (const child of Array.from(viewport.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [children, updateEdges]);

  return <div className={`horizontal-scroll-rail ${className}`.trim()}>
    {!edges.start ? <button type="button" className={`horizontal-scroll-rail__button horizontal-scroll-rail__button--previous ${buttonClassName}`.trim()} onClick={() => viewportRef.current?.scrollBy({ left: -scrollAmount, behavior: "smooth" })} aria-label={`前の${label}を表示`}>‹</button> : null}
    <div
      ref={viewportRef}
      className={`horizontal-scroll-rail__viewport ${viewportClassName}`.trim()}
      aria-label={label}
      onScroll={updateEdges}
      onWheel={(event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        event.currentTarget.scrollLeft += event.deltaY;
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add("is-dragging");
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag.pointerId !== event.pointerId) return;
        const distance = event.clientX - drag.startX;
        if (Math.abs(distance) > 4) drag.moved = true;
        if (!drag.moved) return;
        event.preventDefault();
        event.currentTarget.scrollLeft = drag.scrollLeft - distance;
      }}
      onPointerUp={(event) => {
        if (dragRef.current.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        event.currentTarget.classList.remove("is-dragging");
        dragRef.current.pointerId = -1;
      }}
      onPointerCancel={(event) => {
        event.currentTarget.classList.remove("is-dragging");
        dragRef.current = { pointerId: -1, startX: 0, scrollLeft: 0, moved: false };
      }}
      onClickCapture={(event) => {
        if (!dragRef.current.moved) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current.moved = false;
      }}
    >{children}</div>
    {!edges.end ? <button type="button" className={`horizontal-scroll-rail__button horizontal-scroll-rail__button--next ${buttonClassName}`.trim()} onClick={() => viewportRef.current?.scrollBy({ left: scrollAmount, behavior: "smooth" })} aria-label={`次の${label}を表示`}>›</button> : null}
  </div>;
}
