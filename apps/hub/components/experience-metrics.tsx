"use client";
import { useEffect } from "react";

export function ExperienceMetrics() {
  useEffect(() => {
    if (window.location.pathname !== "/" || sessionStorage.getItem("hub.home.metrics-sent") === "true") return;
    sessionStorage.setItem("hub.home.metrics-sent", "true");
    const send = (metric: string, value: number) => navigator.sendBeacon("/api/telemetry/experience", new Blob([JSON.stringify({ metric, value, route: "/" })], { type: "application/json" }));
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) send("navigation", navigation.loadEventEnd || navigation.duration);
    let cls = 0;
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) {
      if (entry.entryType === "largest-contentful-paint") send("lcp", entry.startTime);
      if (entry.entryType === "layout-shift" && !(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) cls += (entry as PerformanceEntry & { value?: number }).value ?? 0;
      if (entry.entryType === "event") send("inp", entry.duration);
    }});
    try { observer.observe({ type: "largest-contentful-paint", buffered: true }); observer.observe({ type: "layout-shift", buffered: true }); observer.observe({ type: "event", buffered: true, durationThreshold: 200 } as PerformanceObserverInit); } catch { /* Optional browser capability. */ }
    const flush = () => { if (cls > 0) send("cls", cls * 1000); observer.disconnect(); };
    window.addEventListener("pagehide", flush, { once: true });
    return () => { window.removeEventListener("pagehide", flush); observer.disconnect(); };
  }, []);
  return null;
}
