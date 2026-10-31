"use client";

import { useEffect, useState } from "react";

import { V2TagChip } from "@/components/v2/v2-tag-chip";
import type { LibraryPopularTags } from "@/lib/library-column";

/*
 * よく使われているタグ (2026-10-29)。Hub の分は server から、Music の原盤と Commerce の商品の分は
 * ブラウザが各 Worker の公開 API を直接読む（Hub のハンドラーは中継しない）。失敗したら何も出さない。
 */
const REMOTE: Record<"music" | "market", string> = {
  music: "/music/api/v1/tags/popular?limit=10",
  market: "/shopping/api/commerce/api/v1/products/tags/popular?limit=10",
};

function names(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { items?: unknown; tags?: unknown };
  const list = Array.isArray(body.items) ? body.items : Array.isArray(body.tags) ? body.tags : [];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object") {
      const row = entry as { display?: unknown; name?: unknown; tag?: unknown };
      const value = row.display ?? row.name ?? row.tag;
      return typeof value === "string" ? [value] : [];
    }
    return [];
  });
}

export function V2LibraryPopularTags({ popular, japanese }: { popular: LibraryPopularTags; japanese: boolean }) {
  const [remote, setRemote] = useState<string[]>([]);
  useEffect(() => {
    if (!popular.remote) return;
    const controller = new AbortController();
    fetch(REMOTE[popular.remote], { credentials: "omit", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setRemote(names(payload).slice(0, 10)))
      .catch(() => setRemote([]));
    return () => controller.abort();
  }, [popular.remote]);

  const seen = new Set<string>();
  const tags = [...popular.tags, ...remote].map((tag) => tag.trim().replace(/^[#＃]+/u, "")).filter((tag) => {
    const key = tag.normalize("NFKC").toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
  if (!tags.length) return null;
  return (
    <section className="v2-lib__group" aria-labelledby="v2-lib-popular">
      <h2 className="v2-lib__heading" id="v2-lib-popular">{japanese ? "よく使われているタグ" : "Popular tags"}</h2>
      <div className="v2-lib__chips">
        {tags.map((tag) => <V2TagChip key={tag} tag={tag} kind={popular.kind} size="sm" />)}
      </div>
    </section>
  );
}
