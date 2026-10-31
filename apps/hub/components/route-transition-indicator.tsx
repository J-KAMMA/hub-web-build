"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const MINIMUM_VISIBLE_MS = 240;
const NAVIGATION_TIMEOUT_MS = 10_000;

function isInternalPageLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }

  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return false;

  const destination = new URL(link.href, window.location.href);
  const current = new URL(window.location.href);
  if (destination.origin !== current.origin) return false;
  if (destination.pathname === current.pathname) return false;
  return true;
}

export function RouteTransitionIndicator() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const previousPathname = useRef(pathname);
  const startedAt = useRef(0);
  const finishTimer = useRef<number | undefined>(undefined);
  const timeoutTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const clearTimers = () => {
      window.clearTimeout(finishTimer.current);
      window.clearTimeout(timeoutTimer.current);
    };
    const finish = () => {
      clearTimers();
      const elapsed = performance.now() - startedAt.current;
      finishTimer.current = window.setTimeout(
        () => {
          pendingRef.current = false;
          setPending(false);
        },
        Math.max(0, MINIMUM_VISIBLE_MS - elapsed),
      );
    };

    if (pathname === previousPathname.current) return clearTimers;
    previousPathname.current = pathname;
    if (pendingRef.current) finish();
    return () => window.clearTimeout(finishTimer.current);
  }, [pathname]);

  useEffect(() => {
    const start = (event: MouseEvent) => {
      if (!isInternalPageLink(event)) return;
      window.clearTimeout(finishTimer.current);
      window.clearTimeout(timeoutTimer.current);
      startedAt.current = performance.now();
      pendingRef.current = true;
      setPending(true);
      timeoutTimer.current = window.setTimeout(() => {
        pendingRef.current = false;
        setPending(false);
      }, NAVIGATION_TIMEOUT_MS);
    };

    document.addEventListener("click", start, true);
    return () => {
      window.clearTimeout(finishTimer.current);
      window.clearTimeout(timeoutTimer.current);
      document.removeEventListener("click", start, true);
    };
  }, []);

  if (!pending) return null;

  return (
    <aside className="route-transition-indicator" role="status" aria-live="polite" aria-label="Hubを読み込み中">
      <span className="route-transition-indicator__bar" aria-hidden="true" />
      <strong>Hub</strong>
      <small>読み込み中…</small>
    </aside>
  );
}
