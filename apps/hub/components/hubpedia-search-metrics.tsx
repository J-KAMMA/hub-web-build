"use client";

import { useEffect } from "react";

export function HubpediaSearchMetrics({ query, resultCount }: { query: string; resultCount: number }) {
  useEffect(() => {
    const normalized = query.normalize("NFKC").trim();
    if (!normalized) return;
    const controller = new AbortController();
    void fetch("/api/hubpedia/search-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: normalized, resultCount, outcome: resultCount > 0 ? "shown" : "abandoned" }),
      credentials: "same-origin",
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [query, resultCount]);
  return null;
}
