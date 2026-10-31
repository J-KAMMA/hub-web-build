"use client";

import { useEffect, useRef, useState } from "react";
import type { HubArticleContent } from "./article-content";
type Cursor = { createdAt: string; id: string };

export function useArticleCandidates(initial: HubArticleContent[], enabled: boolean) {
  const [members, setMembers] = useState(() => initial.filter(item => item.source === "member"));
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(enabled);
  const [batch, setBatch] = useState(0);
  const cursor = useRef<Cursor | null>(null);
  const completed = useRef(false);

  useEffect(() => {
    if (!enabled || completed.current) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        for (let page = 0; page < 20; page++) {
          const before = cursor.current;
          const params = new URLSearchParams();
          if (before) { params.set("before", before.createdAt); params.set("id", before.id); }
          const response = await fetch(`/api/articles/discovery${params.size ? `?${params}` : ""}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Article candidates unavailable");
          const body = await response.json();
          if (controller.signal.aborted) return;
          if (!Array.isArray(body.articles) || body.articles.some((item: HubArticleContent) => !item || item.source !== "member" || item.audience !== "general" || item.access !== "public" || typeof item.contentId !== "string" || typeof item.title !== "string" || typeof item.summary !== "string" || typeof item.author !== "string" || typeof item.href !== "string" || (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== "string"))))) throw new Error("Invalid article candidates");
          const next = body.nextCursor as Cursor | null;
          if (next !== null && (!next || typeof next.createdAt !== "string" || typeof next.id !== "string" || (before && next.createdAt === before.createdAt && next.id === before.id))) throw new Error("Invalid article cursor");
          setMembers(previous => [...new Map([...(before ? previous : []), ...body.articles].map((item: HubArticleContent) => [item.contentId, item])).values()]);
          cursor.current = next;
          setHasMore(next !== null);
          if (!next) { completed.current = true; break; }
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [enabled, batch]);

  return { articles: enabled ? [...initial.filter(item => item.source !== "member"), ...members] : initial,
    loading: enabled && loading, error: enabled && error, hasMore: enabled && hasMore,
    continueLoading: () => setBatch(value => value + 1) };
}
