"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { isHubOriginalWork, type MusicWork } from "@/lib/music-catalog";
import {
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  playPersistentMusic,
  setPersistentMusicQueue,
  type PersistentMusicPlayerState,
} from "@/lib/music-player-events";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2MusicRow } from "@/components/v2/v2-music-row";
import { rankMusicWorks } from "@/lib/music-ranking";
import { useMusicRecommendations } from "@/lib/use-music-recommendations";
import { useMusicFavorites } from "@/lib/use-music-favorites";
import { useMusicFavoriteWorks } from "@/lib/use-music-favorite-works";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { orderPlaybackQueue, originalsFirst, searchLayout } from "@/lib/music-originals-first";
import { matchesMusicFilters, playableTrack, type V2MusicFilters, type V2MusicSort } from "@/lib/v2-music";

/*
 * 音楽の一覧。既存の music-discovery.tsx（1,300行）から一覧と再生の機能だけを抜いた。
 *
 * 落とさなかったもの: 静的カタログ＋コミュニティ作品、人気／新着／お気に入り、
 * ジャンル・タグ・語の絞り込み、Hub内再生（常駐プレーヤーへ渡す。プレーヤーは
 * 既存のまま root layout に載っている）、続けて再生の待ち行列、外部サービスへの
 * 導線、お気に入り（未ログインは端末、ログインは /api/music/favorites。鍵は既存と
 * 共用 music.favorites）。
 *
 * まだ無いもの: おすすめ（聴取プロファイル）、プレイリスト、あとで聴く、
 * 意味検索の札、原盤のアップロード、URL貼付からの登録（サーバーが410で終了済み）。
 */


const MORE = 60;

export function V2MusicList({
  works: initialWorks,
  communityOffset,
  communityTotal,
  filters,
  sort,
  initialFavoriteIds,
  authenticated,
  locale,
}: {
  works: MusicWork[];
  /* コミュニティ作品の読み込み済みの件数と全件数。続きは /api/music で取る。 */
  communityOffset: number;
  communityTotal: number;
  filters: V2MusicFilters;
  sort: V2MusicSort;
  initialFavoriteIds: string[];
  authenticated: boolean;
  locale: string;
}) {
  const ja = locale === "ja";
  const feedback = useDiscoveryFeedback("music");
  const recommended = sort === "recommended" && !filters.query;
  const [works, setWorks] = useState(initialWorks);
  const [offset, setOffset] = useState(communityOffset);
  const [total, setTotal] = useState(communityTotal);
  const [loadingMore, setLoadingMore] = useState(false);
  const favoriteState = useMusicFavorites(initialFavoriteIds, authenticated);
  const { favorites } = favoriteState;
  const favoriteWorks=useMusicFavoriteWorks(favorites,sort==="favorites");

  /* 続き。既存の一覧と同じ /api/music を同じ絞り込みで叩く（コミュニティ作品だけが増える）。 */
  const loadMore = async () => {
    if (loadingMore || offset >= total) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ limit: String(MORE), offset: String(offset) });
      if (filters.genre) query.append("genre", filters.genre);
      for (const tag of filters.tags) query.append("tag", tag);
      if (filters.query) query.set("q", filters.query);
      const response = await fetch(`/api/music?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { works: MusicWork[]; total: number; nextOffset?: number };
      const nextOffset = payload.nextOffset ?? offset + (Array.isArray(payload.works) ? payload.works.length : 0);
      if (!Array.isArray(payload.works) || !Number.isSafeInteger(payload.total) || payload.total < 0 || !Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > payload.total || (nextOffset <= offset && offset < payload.total)) throw new Error("Invalid music page");
      setWorks((current) => {
        const known = new Set(current.map((work) => work.id));
        return [...current, ...payload.works.filter((work) => !known.has(work.id))];
      });
      setOffset(nextOffset);
      setTotal(payload.total);
      setMessage(null);
    } catch {
      setMessage(ja ? "続きを読み込めませんでした。" : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showExternal, setShowExternal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* 未ログインの端末にあるお気に入りは、最初の描画の後に読む（サーバーには無い）。 */


  /* 常駐プレーヤーが何を鳴らしているか。既存の右列と同じ問い合わせ。 */
  useEffect(() => {
    const onState = (event: Event) => {
      const state = (event as CustomEvent<PersistentMusicPlayerState>).detail;
      setPlayingId(state?.track?.id ?? null);
    };
    window.addEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
    window.dispatchEvent(new Event(MUSIC_PLAYER_STATE_REQUEST_EVENT));
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
  }, []);

  const recommend = useMusicRecommendations();
  const ranked = useMemo(() => {
    const matched = (sort==="favorites"?favoriteWorks.works:works).filter((work) => matchesMusicFilters(work, filters));
    /* どの並びでも Hub のオリジナルが先、外部の曲は後（それぞれの中は並びのまま）。 */
    if (sort === "favorites") return originalsFirst(matched.filter((work) => favorites.includes(work.id)));
    if (sort === "latest") return originalsFirst([...matched].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.year - a.year));
    return originalsFirst(sort === "recommended" ? recommend(matched, favorites) : rankMusicWorks(matched));
  }, [works, filters, sort, favorites, recommend,favoriteWorks.works]);
  const visible = ranked.filter(work => !recommended || !feedback.isHidden(work.id));
  const layout = searchLayout(visible);

  const play = useCallback((work: MusicWork) => {
    const track = playableTrack(work, true);
    if (!track) {
      setMessage(ja ? "この作品は外部サイトでだけ再生できます。" : "This work only plays on an external site.");
      return;
    }
    /* 続けて鳴る順: 押した曲、残りのオリジナル、最後に外部の曲。 */
    const queue = orderPlaybackQueue(layout.collapseExternal && !showExternal ? layout.originals : visible, work.id).map((item) => playableTrack(item, false)).filter((item): item is NonNullable<typeof item> => item !== null);
    setPersistentMusicQueue(queue, work.id);
    playPersistentMusic(track);
    setPlayingId(work.id);
    setMessage(null);
  }, [visible, layout, showExternal, ja]);



  const renderRow = (work: MusicWork) => <V2MusicRow key={work.id} work={work} compact={!isHubOriginalWork(work)} current={playingId === work.id} favorite={favorites.includes(work.id)} japanese={ja} onPlay={() => play(work)} favoriteSaving={favoriteState.saving} onFavorite={() => void favoriteState.toggle(work.id)} onDismiss={recommended && !isHubOriginalWork(work) ? () => feedback.dismiss(work.id) : undefined} />;

  return (
    <div className="v2-mlist">
      {sort==="favorites"&&favoriteWorks.status!=="ready"?<p role="status">{favoriteWorks.status==="loading"?(ja?"お気に入りを読み込み中…":"Loading favourites…"):<>{ja?"お気に入りの作品を読み込めませんでした。":"Could not load favourite works."}<button className="v2-button v2-button--text" onClick={favoriteWorks.retry}>{ja?"もう一度読み込む":"Try again"}</button></>}</p>:null}
      {message ? <p className="v2-error" role="status">{message}</p> : null}
      {favoriteState.error ? <p className="v2-error" role="alert">{favoriteState.error === "cache"
        ? (ja ? "アカウントに保存しましたが、この端末には記録できませんでした。" : "Saved to your account, but could not update this device's cache.")
        : (ja ? "お気に入りを保存できませんでした。もう一度お試しください。" : "Could not save favourites. Please try again.")}</p> : null}
      {recommended ? <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} /> : null}
      {visible.length ? (
        <>
          {layout.originals.length ? <ul className="v2-music-results">
            {layout.originals.map(renderRow)}
          </ul> : null}
          {layout.external.length ? (
            layout.collapseExternal && !showExternal ? (
              <div className="v2-mlist__external">
                <button type="button" className="v2-toggle v2-toggle--text" onClick={() => setShowExternal(true)}>{ja ? `YouTube Musicも表示（${layout.external.length}）` : `Show YouTube Music (${layout.external.length})`}</button>
              </div>
            ) : (
              <div className={layout.originals.length ? "v2-mlist__external" : undefined}>
                {layout.originals.length ? <div className="v2-shelf__sub"><h3 className="v2-shelf__subtitle">YouTube Music</h3></div> : null}
                <ul className="v2-music-results">{layout.external.map(renderRow)}</ul>
              </div>
            )
          ) : null}
        </>
      ) : recommended && ranked.length > 0 ? (
        <p className="v2-note">{ja ? "おすすめは非表示になっています。検索や別の並び順で探すか、設定で非表示をリセットできます。" : "Recommendations are hidden. Search, change sort or reset hidden recommendations in settings."}</p>
      ) : sort==="favorites"&&favoriteWorks.status!=="ready"?null:(
        sort === "favorites"
          ? <V2Empty title={favorites.length?(ja?"表示できるお気に入りがありません":"No matching available favourites"):(ja?"お気に入りはまだありません":"No favourites yet")} note={favorites.length?(ja?"絞り込み条件や作品の公開状態を確認してください。":"Check your filters and work availability."):(ja?"作品の♡から足せます。":"Use the heart on any work.")} action={{ label: ja ? "作品を探す" : "Browse works", href: "/v2/music" }} />
          : <V2Empty title={ja ? "条件に合う作品がありません" : "No works matched"} action={{ label: ja ? "絞り込みを解除" : "Clear filters", href: "/v2/music" }} />
      )}
      {sort!=="favorites"&&offset < total ? (
        <div className="v2-replies__more">
          <button type="button" className="v2-toggle v2-toggle--text" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? (ja ? "読み込み中…" : "Loading…") : (ja ? "続きを読む" : "Load more")}
          </button>
          <small>{ja ? `コミュニティ作品 ${offset} / ${total}` : `Community works ${offset} / ${total}`}</small>
        </div>
      ) : null}
    </div>
  );
}
