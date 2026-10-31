"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/v2/ui/button";
import { V2ImageDetail, V2ImageMasonry, useInfiniteSentinel } from "@/components/v2/v2-image-grid";
import { V2ImageSaveSheet } from "@/components/v2/v2-image-save-sheet";
import { fetchCommonsImages, fetchOpenverseImages, type ImageItem, type ImagePage } from "@/lib/image-search";
import "@/app/v2/v2-image-search.css";

/*
 * 検索の「画像」札 (2026-10-29)。Google 画像検索と Pinterest の間のような敷き詰め表示。
 * 出どころは4つ。
 *   hub / remote : Hub の API (/api/search/images)。公開でないものはサーバーで落としてある。
 *   openverse / commons : ブラウザから直接。Hub のハンドラーは中継しない。
 * どの出どころも失敗は静かに扱う。取れなかった節はただ無い (エラーを出さない)。
 */

type Source = "hub" | "remote" | "openverse" | "commons";
const SOURCES: readonly Source[] = ["hub", "remote", "openverse", "commons"];

type Section = { items: ImageItem[]; cursor: string | null; done: boolean };
type Sections = Record<Source, Section>;

const EMPTY: Section = { items: [], cursor: null, done: false };
const initialSections = (): Sections => ({ hub: { ...EMPTY }, remote: { ...EMPTY }, openverse: { ...EMPTY }, commons: { ...EMPTY } });

async function hubSource(source: "hub" | "remote", query: string, cursor: string | null, signal: AbortSignal, fetcher: typeof fetch): Promise<ImagePage | null> {
  try {
    const params = new URLSearchParams({ source, q: query });
    if (cursor) params.set("cursor", cursor);
    const response = await fetcher(`/api/search/images?${params.toString()}`, { credentials: "same-origin", signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === "object" && Array.isArray((body as ImagePage).items) ? (body as ImagePage) : null;
  } catch {
    return null;
  }
}

/* One item from each section in turn, so no single source fills the screen. */
export function interleaveImages(sections: Sections): ImageItem[] {
  const lists = SOURCES.map((source) => sections[source].items);
  const seen = new Set<string>();
  const merged: ImageItem[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item && !seen.has(item.key)) {
        seen.add(item.key);
        merged.push(item);
      }
    }
  }
  return merged;
}

export function V2ImageSearch({ query, signedIn, japanese, fetcher }: { query: string; signedIn: boolean; japanese: boolean; fetcher?: typeof fetch }) {
  const [sections, setSections] = useState<Sections>(initialSections);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ImageItem | null>(null);
  const [saving, setSaving] = useState<ImageItem | null>(null);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const run = fetcher ?? (typeof fetch === "function" ? fetch : (undefined as unknown as typeof fetch));
  const runRef = useRef(run);
  runRef.current = run;

  const loadMore = useCallback(async (q: string) => {
    if (inFlight.current) return;
    const current = sectionsRef.current;
    const pending = SOURCES.filter((source) => !current[source].done);
    if (!pending.length) return;
    inFlight.current = true;
    setLoading(true);
    const signal = controller.current?.signal;
    if (!signal) { inFlight.current = false; return; }
    const results = await Promise.all(pending.map(async (source): Promise<[Source, ImagePage | null]> => {
      const cursor = current[source].cursor;
      const fetched = source === "hub" || source === "remote"
        ? await hubSource(source, q, cursor, signal, runRef.current)
        : source === "openverse"
          ? await fetchOpenverseImages(q, cursor, runRef.current, signal)
          : await fetchCommonsImages(q, cursor, runRef.current, signal);
      return [source, fetched];
    }));
    if (signal.aborted) return;
    setSections((previous) => {
      const next = { ...previous };
      for (const [source, page] of results) {
        // A failed or rate-limited source stops here: its section simply stays as it was.
        next[source] = page
          ? { items: [...previous[source].items, ...page.items], cursor: page.nextCursor, done: page.nextCursor === null }
          : { ...previous[source], done: true };
      }
      return next;
    });
    inFlight.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    inFlight.current = false;
    sectionsRef.current = initialSections();
    setSections(sectionsRef.current);
    setDetail(null);
    void loadMore(query);
    return () => abort.abort();
  }, [query, loadMore]);

  const items = useMemo(() => interleaveImages(sections), [sections]);
  const hasMore = SOURCES.some((source) => !sections[source].done);
  const sentinel = useInfiniteSentinel(() => void loadMore(query), hasMore && !loading);
  const label = japanese ? "画像の検索結果" : "Image results";

  return (
    <section className="v2-imgsearch" aria-labelledby="v2-imgsearch-title">
      <h2 id="v2-imgsearch-title" className="v2-column__title v2-column__title--section">{japanese ? "画像" : "Images"}</h2>
      {items.length ? (
        <V2ImageMasonry items={items} japanese={japanese} onOpen={setDetail} onSave={setSaving} label={label} />
      ) : !loading && !hasMore ? (
        <p className="v2-note">{japanese ? "一致する画像はありません。" : "No images matched."}</p>
      ) : null}
      {loading ? <p className="v2-note" role="status">{japanese ? "探しています…" : "Searching…"}</p> : null}
      {hasMore ? (
        <div ref={sentinel} className="v2-imgsearch__more">
          <Button variant="secondary" label={japanese ? "もっと見る" : "Show more"} busy={loading} onClick={() => void loadMore(query)} />
        </div>
      ) : null}
      <p className="v2-imgsearch__credit">
        {japanese
          ? "外部の画像は Openverse と Wikimedia Commons から取得しています。各画像のライセンスと作者を確認してから使ってください。"
          : "External images come from Openverse and Wikimedia Commons. Check each image's licence and creator before reuse."}
      </p>
      <V2ImageDetail item={detail} japanese={japanese} onClose={() => setDetail(null)} onPick={setDetail} onSave={setSaving} fetcher={fetcher} />
      <V2ImageSaveSheet item={saving} signedIn={signedIn} japanese={japanese} onClose={() => setSaving(null)} fetcher={fetcher} />
    </section>
  );
}
