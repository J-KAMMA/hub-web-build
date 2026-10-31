"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/v2/ui/button";
import { Sheet } from "@/components/v2/ui/sheet";
import { fetchCommonsImages, fetchOpenverseImages, similarQueryTerms, type ImageItem, type ImagePage } from "@/lib/image-search";
import "@/app/v2/v2-image-search.css";

/*
 * 画像の敷き詰め表示と詳細 (2026-10-29)。検索の「画像」札とボードの両方が使う。
 * 列は CSS columns。画像は width/height から aspect-ratio を先に決めて、読み込みで動かない。
 * 外の出どころ (Openverse / Commons) はブラウザが直接呼ぶ。失敗したら似た画像の節ごと出さない。
 */

const FALLBACK_RATIO = "4 / 3";

export function imageRatio(item: Pick<ImageItem, "width" | "height">): string {
  return item.width && item.height ? `${item.width} / ${item.height}` : FALLBACK_RATIO;
}

/* Hub の画像は原寸の変種があり、外の画像は渡された縮小版だけを使う。 */
export function imageLargeUrl(item: ImageItem): string {
  return item.kind === "hub-post" ? item.thumbnailUrl.replace("variant=thumbnail", "variant=full") : item.thumbnailUrl;
}

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function kindLabel(kind: ImageItem["kind"], japanese: boolean): string {
  switch (kind) {
    case "hub-post": return japanese ? "Hubの投稿" : "Hub post";
    case "hub-article": return japanese ? "Hubの記事" : "Hub article";
    case "remote": return japanese ? "他のHub" : "Other Hub";
    case "openverse": return "Openverse";
    case "commons": return "Wikimedia Commons";
  }
}

/** Calls onVisible while the sentinel is on screen. Without IntersectionObserver the "more" button is the way. */
export function useInfiniteSentinel(onVisible: () => void, enabled: boolean) {
  const callback = useRef(onVisible);
  callback.current = onVisible;
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) callback.current();
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node]);
  return setNode;
}

export function V2ImageMasonry({
  items,
  japanese,
  onOpen,
  onSave,
  extra,
  label,
}: {
  items: readonly ImageItem[];
  japanese: boolean;
  onOpen: (item: ImageItem) => void;
  onSave?: (item: ImageItem) => void;
  /* 各タイルの末尾の操作 (ボードから外す、など) */
  extra?: (item: ImageItem) => ReactNode;
  label: string;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  return (
    <ul className="v2-imgs" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="v2-imgs__tile">
          <button type="button" className="v2-imgs__open" aria-label={`${japanese ? "画像を開く" : "Open image"}: ${item.title}`} onClick={() => onOpen(item)}>
            {failed.has(item.key) ? (
              <span className="v2-imgs__broken" style={{ aspectRatio: imageRatio(item) }}>{japanese ? "表示できません" : "Unavailable"}</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                width={item.width ?? undefined}
                height={item.height ?? undefined}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                style={{ aspectRatio: imageRatio(item) }}
                onError={() => setFailed((current) => new Set(current).add(item.key))}
              />
            )}
          </button>
          <div className="v2-imgs__meta">
            <span className="v2-imgs__title">{item.title}</span>
            <span className="v2-imgs__licence">{item.licence || kindLabel(item.kind, japanese)}</span>
          </div>
          <div className="v2-imgs__actions">
            {onSave ? <Button variant="secondary" label={japanese ? "保存" : "Save"} onClick={() => onSave(item)} /> : null}
            {extra?.(item)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function postIdOf(item: ImageItem): string | null {
  const match = item.kind === "hub-post" ? /^\/v2\/posts\/([^/?#]+)/.exec(item.sourceUrl) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function hubPage(url: string, fetcher: typeof fetch): Promise<ImagePage | null> {
  try {
    const response = await fetcher(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as ImagePage).items)) return null;
    return body as ImagePage;
  } catch {
    return null;
  }
}

/* 似た画像。Hub の投稿の画像はタグを共有するもの、足りなければ題の語。どれも取れなければ null。 */
export async function loadSimilarImages(item: ImageItem, fetcher: typeof fetch = fetch): Promise<ImageItem[] | null> {
  const terms = similarQueryTerms(item);
  let page: ImagePage | null = null;
  const postId = postIdOf(item);
  if (postId) page = await hubPage(`/api/search/images?source=hub&similarTo=${encodeURIComponent(postId)}`, fetcher);
  if (!page?.items.length && terms) {
    if (item.kind === "openverse") page = await fetchOpenverseImages(terms, null, fetcher);
    else if (item.kind === "commons") page = await fetchCommonsImages(terms, null, fetcher);
    else page = await hubPage(`/api/search/images?source=${item.kind === "remote" ? "remote" : "hub"}&q=${encodeURIComponent(terms)}`, fetcher);
  }
  if (!page) return null;
  const others = page.items.filter((other) => other.key !== item.key).slice(0, 12);
  return others.length ? others : null;
}

export function V2ImageDetail({
  item,
  japanese,
  onClose,
  onPick,
  onSave,
  fetcher,
}: {
  item: ImageItem | null;
  japanese: boolean;
  onClose: () => void;
  onPick: (item: ImageItem) => void;
  onSave?: (item: ImageItem) => void;
  fetcher?: typeof fetch;
}) {
  const [similar, setSimilar] = useState<ImageItem[] | null>(null);
  const [broken, setBroken] = useState(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const key = item?.key ?? null;

  useEffect(() => {
    setSimilar(null);
    setBroken(false);
    if (!item) return;
    let live = true;
    void loadSimilarImages(item, fetchRef.current ?? fetch).then((result) => {
      if (live) setSimilar(result);
    });
    return () => { live = false; };
    // The item is identified by its key; a new object for the same key must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const open = useCallback(() => onClose(), [onClose]);
  if (!item) return null;
  const external = isExternalHref(item.sourceUrl);
  return (
    <Sheet open onClose={open} title={japanese ? "画像の詳細" : "Image details"} hideTitle className="v2-imgd-sheet">
      <div className="v2-imgd">
        {broken ? (
          <p className="v2-imgd__broken" role="img" aria-label={item.title}>{japanese ? "画像を表示できません" : "Image unavailable"}</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="v2-imgd__image"
            src={imageLargeUrl(item)}
            alt={item.title}
            width={item.width ?? undefined}
            height={item.height ?? undefined}
            referrerPolicy="no-referrer"
            style={{ aspectRatio: imageRatio(item) }}
            onError={() => setBroken(true)}
          />
        )}
        <h2 className="v2-imgd__title">{item.title}</h2>
        <dl className="v2-imgd__facts">
          <div><dt>{japanese ? "出どころ" : "Source"}</dt><dd>{kindLabel(item.kind, japanese)}</dd></div>
          {item.creator ? <div><dt>{japanese ? "作者" : "Creator"}</dt><dd>{item.creator}</dd></div> : null}
          {item.licence ? <div><dt>{japanese ? "ライセンス" : "Licence"}</dt><dd>{item.licence}</dd></div> : null}
        </dl>
        <div className="v2-imgd__buttons">
          {external ? (
            <a className="ui-button ui-button--primary" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
              <span className="ui-button__label">{japanese ? "元のページを開く" : "Open the original page"}</span>
            </a>
          ) : (
            <Link className="ui-button ui-button--primary" href={item.sourceUrl}>
              <span className="ui-button__label">{japanese ? "元のページを開く" : "Open the original page"}</span>
            </Link>
          )}
          {onSave ? <Button variant="secondary" label={japanese ? "ボードに保存" : "Save to board"} onClick={() => onSave(item)} /> : null}
        </div>
        {similar ? (
          <section className="v2-imgd__similar" aria-labelledby="v2-imgd-similar-title">
            <h3 id="v2-imgd-similar-title" className="v2-imgd__subtitle">{japanese ? "似た画像" : "Similar images"}</h3>
            <V2ImageMasonry items={similar} japanese={japanese} onOpen={onPick} label={japanese ? "似た画像" : "Similar images"} />
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
