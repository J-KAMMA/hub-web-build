"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/v2/ui/avatar";
import { AsideWallet } from "@/components/v2/v2-aside-wallet";

/*
 * 右列の「探す」タブの下段。**中身のある節だけを積む**（旦那様 2026-10-31「右が見苦しい」）。
 *   いま話題       /api/tags?mode=trending（集計済みのタグ）。空なら /api/tags?mode=popular（同じ API の公開タグ上位）
 *   おすすめのユーザー  /api/suggested-users。ログイン時は閲覧者向け、未ログインは直近の公開投稿の書き手
 *   ウォレット      上の2つが両方空のときだけ、ログイン中の人に既存の要約カード
 * 全部空なら一言だけ。どれも探すタブが開かれたときにだけ読み、結果は数分、この端末のメモリに持つ。
 * 検索欄は上端の帯にあるので、ここには置かない。
 */

export type TrendingTag = { name: string; key: string; recentCount: number; recent?: boolean };
export type SuggestedUser = { handle: string; displayName: string; avatarUrl: string | null };

const MEMORY_MS = 5 * 60 * 1000;
const memory = new Map<string, { at: number; value: unknown }>();

/** テスト用。端末のメモリを空にする。 */
export function resetAsideDiscoverMemory() {
  memory.clear();
}

function remembered<T>(key: string): T | null {
  const hit = memory.get(key);
  return hit && Date.now() - hit.at < MEMORY_MS ? (hit.value as T) : null;
}

type Loaded<T> = { state: "loading" | "ready" | "failed"; value: T };

function useLoaded<T>(key: string, url: string | null, pick: (payload: unknown) => T, empty: T): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>(() => {
    const hit = remembered<T>(key);
    return hit ? { state: "ready", value: hit } : { state: url ? "loading" : "ready", value: empty };
  });
  useEffect(() => {
    if (!url) return;
    const hit = remembered<T>(key);
    if (hit) { setLoaded({ state: "ready", value: hit }); return; }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(String(response.status));
        const value = pick(await response.json());
        memory.set(key, { at: Date.now(), value });
        if (!cancelled) setLoaded({ state: "ready", value });
      } catch {
        if (!cancelled) setLoaded({ state: "failed", value: empty });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);
  return loaded;
}

export function trendSearchHref(tag: Pick<TrendingTag, "name">): string {
  return `/v2/search?q=${encodeURIComponent(`#${tag.name}`)}`;
}

export function pickTrendingTags(payload: unknown): TrendingTag[] {
  const tags = (payload as { tags?: TrendingTag[] } | null)?.tags;
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag?.name === "string" && typeof tag?.key === "string").slice(0, 5) : [];
}

/* popular は useCount（累計）を返す。「直近」とは書けないので recent=false を付ける。 */
export function pickPopularTags(payload: unknown): TrendingTag[] {
  const tags = (payload as { tags?: { name?: unknown; key?: unknown; useCount?: unknown }[] } | null)?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag) => typeof tag?.name === "string" && typeof tag?.key === "string" && Number(tag.useCount) > 0)
    .slice(0, 5)
    .map((tag) => ({ name: tag.name as string, key: tag.key as string, recentCount: Number(tag.useCount), recent: false }));
}

export function pickSuggestedUsers(payload: unknown): SuggestedUser[] {
  const users = (payload as { users?: SuggestedUser[] } | null)?.users;
  return Array.isArray(users) ? users.filter((user) => typeof user?.handle === "string").slice(0, 5) : [];
}

/* 読み込み中だけの骨組み（行 52px × 3）。読み込み後は中身のある節だけに置き換わる。 */
function RowsSkeleton({ label }: { label: string }) {
  return (
    <div className="v2-discover__skeleton" role="status" aria-busy="true">
      <span className="v2-sr">{label}</span>
      {Array.from({ length: 3 }, (_, index) => <span key={index} className="v2-discover__skeleton-row" aria-hidden="true" />)}
    </div>
  );
}

export function AsideDiscover({ japanese, signedIn, scope }: { japanese: boolean; signedIn: boolean; scope: string }) {
  const trending = useLoaded<TrendingTag[]>("trends", "/api/tags?mode=trending&limit=5", pickTrendingTags, []);
  const trendingEmpty = trending.state !== "loading" && !trending.value.length;
  const popular = useLoaded<TrendingTag[]>("popular-tags", trendingEmpty ? "/api/tags?mode=popular&limit=5" : null, pickPopularTags, []);
  const people = useLoaded<SuggestedUser[]>(`people:${scope}`, "/api/suggested-users", pickSuggestedUsers, []);

  const tags = trending.value.length ? trending.value : popular.value;
  const tagsPending = trending.state === "loading" || (trendingEmpty && popular.state === "loading");
  const pending = tagsPending || people.state === "loading";
  const hasTags = tags.length > 0;
  const hasPeople = people.value.length > 0;
  const walletFallback = !pending && !hasTags && !hasPeople && signedIn;
  const nothing = !pending && !hasTags && !hasPeople && !signedIn;
  const loading = japanese ? "読み込んでいます" : "Loading";

  return (
    <div className="v2-discover">
      {pending && !hasTags && !hasPeople ? <RowsSkeleton label={loading} /> : null}

      {hasTags ? (
        <section aria-labelledby="v2-discover-trends" className="v2-discover__section">
          <h3 className="v2-aside__heading" id="v2-discover-trends">{trending.value.length ? (japanese ? "いま話題" : "Trending now") : (japanese ? "人気のタグ" : "Popular tags")}</h3>
          <ol className="v2-aside__list">
            {tags.map((tag) => (
              <li key={tag.key}>
                <Link className="v2-aside__item" href={trendSearchHref(tag)}>
                  <span className="v2-aside__item-name">#{tag.name}</span>
                  <span className="v2-aside__item-body">
                    {tag.recent === false
                      ? (japanese ? `${tag.recentCount}件の投稿` : `${tag.recentCount} posts`)
                      : (japanese ? `直近 ${tag.recentCount}件の投稿` : `${tag.recentCount} recent posts`)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {hasPeople ? (
        <section aria-labelledby="v2-discover-people" className="v2-discover__section">
          <h3 className="v2-aside__heading" id="v2-discover-people">{signedIn ? (japanese ? "おすすめのユーザー" : "Who to follow") : (japanese ? "最近活動している人" : "Recently active")}</h3>
          <ul className="v2-aside__list">
            {people.value.map((user) => (
              <li key={user.handle}>
                <Link className="v2-aside__item v2-aside__person" href={`/v2/profile/${encodeURIComponent(user.handle)}`}>
                  <Avatar name={user.displayName} src={user.avatarUrl} size={40} />
                  <span className="v2-aside__person-text">
                    <span className="v2-aside__item-name">{user.displayName}</span>
                    <span className="v2-aside__item-body">@{user.handle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {walletFallback ? (
        <section aria-labelledby="v2-discover-wallet" className="v2-discover__section">
          <h3 className="v2-aside__heading" id="v2-discover-wallet">{japanese ? "ウォレット" : "Wallet"}</h3>
          <AsideWallet japanese={japanese} />
        </section>
      ) : null}

      {nothing ? <p className="v2-note v2-discover__none">{japanese ? "いまは表示できるものがありません。" : "Nothing to show right now."}</p> : null}

      <nav className="v2-aside__footer" aria-label={japanese ? "Hubについて" : "About Hub"}>
        <Link href="/v2/terms">{japanese ? "利用規約" : "Terms"}</Link>
        <Link href="/v2/privacy">{japanese ? "プライバシー" : "Privacy"}</Link>
        <Link href="/v2/about">About</Link>
      </nav>
    </div>
  );
}
