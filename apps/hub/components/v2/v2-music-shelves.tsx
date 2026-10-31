"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { V2MusicHero } from "@/components/v2/v2-music-hero";
import { V2MusicRow } from "@/components/v2/v2-music-row";
import { V2MusicTile } from "@/components/v2/v2-music-tile";
import { MUSIC_PLAYER_STATE_EVENT, MUSIC_PLAYER_STATE_REQUEST_EVENT, playPersistentMusic, setPersistentMusicQueue, type PersistentMusicPlayerState } from "@/lib/music-player-events";
import { canonicalizeMusicWorks, isHubOriginalWork, type MusicWork } from "@/lib/music-catalog";
import { rankMusicWorks } from "@/lib/music-ranking";
import { fillSlot, MUSIC_SLOT_SIZE, orderPlaybackQueue, splitByOrigin } from "@/lib/music-originals-first";
import { musicGenreChipLabel, playableTrack } from "@/lib/v2-music";
import { useMusicRecommendations } from "@/lib/use-music-recommendations";
import { useMusicFavorites } from "@/lib/use-music-favorites";
import { useMusicFavoriteWorks } from "@/lib/use-music-favorite-works";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";

/*
 * 音楽の入口（2026-09-03、旦那様「音楽は音楽用のuiにして」）。
 * 索引サイトの格子ではなく、音楽アプリの棚。横に流す帯を縦に積む: 新着・人気・
 * お気に入り・ジャンルごと。小さなジャケットと2行の情報を、縦4件ずつ横に並べる。
 * 再生すると、その帯が続けて鳴る（帯ごとに待ち行列を作る）。
 * 鳴っているものの印と、お気に入りの記憶は既存の一覧（v2-music-list）と同じ仕組み。
 */


/*
 * works は Hub のオリジナル（先に出す）、external は穴埋めの外部の曲（YouTube）。
 * external は別の見出し「YouTube Music」の下に出し、枠（MUSIC_SLOT_SIZE）が
 * オリジナルで埋まれば 0 件。選び方は棚の id による（hub-latest=おすすめ順、popular=人気順、genre:*=そのジャンル）。
 */
export type MusicShelf = { id: string; title: string; href?: string; works: MusicWork[]; external?: MusicWork[] };

export function V2MusicShelves({ shelves, initialFavoriteIds, authenticated, locale, communityOffset = 0, communityTotal = 0, expandGenres = false, externalBrowse = true }: {
  shelves: MusicShelf[];
  initialFavoriteIds: string[];
  authenticated: boolean;
  locale: string;
  communityOffset?: number;
  communityTotal?: number;
  expandGenres?: boolean;
  /* false: オリジナルが十分あるので、外部の曲のジャンル棚などは出さない。 */
  externalBrowse?: boolean;
}) {
  const ja = locale === "ja";
  const feedback = useDiscoveryFeedback("music");
  const recommend = useMusicRecommendations();
  const favoriteState = useMusicFavorites(initialFavoriteIds, authenticated);
  const { favorites } = favoriteState;
  const hasFavoriteShelf = shelves.some(shelf => shelf.id === "favorites");
  const favoriteWorks = useMusicFavoriteWorks(favorites, hasFavoriteShelf);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [extraWorks, setExtraWorks] = useState<MusicWork[]>([]);
  const [offset, setOffset] = useState(communityOffset);
  const [total, setTotal] = useState(communityTotal);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState(false);
  const [candidatePagesLeft, setCandidatePagesLeft] = useState(20);
  const candidateRequest = useRef<AbortController | null>(null);
  const loadCandidates = useCallback(async () => {
    if (candidateRequest.current || offset >= total) return;
    const controller = new AbortController();
    candidateRequest.current = controller;
    setLoadingCandidates(true);
    try {
      const response = await fetch(`/api/music?limit=60&offset=${offset}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Candidates unavailable");
      const body = await response.json() as { works: MusicWork[]; total: number; nextOffset?: number };
      const nextOffset = body.nextOffset ?? offset + (Array.isArray(body.works) ? body.works.length : 0);
      if (!Array.isArray(body.works) || !Number.isSafeInteger(body.total) || body.total < 0 || !Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > body.total || (nextOffset <= offset && offset < body.total)) throw new Error("Invalid candidate page");
      const incoming = canonicalizeMusicWorks(body.works);
      if (controller.signal.aborted) return;
      setExtraWorks(current => canonicalizeMusicWorks([...current, ...incoming]));
      setOffset(nextOffset);
      setTotal(body.total);
      setCandidateError(false);
      setCandidatePagesLeft(current => Math.max(0, current - 1));
    } catch { if (!controller.signal.aborted) setCandidateError(true); }
    finally {
      if (candidateRequest.current === controller) {
        candidateRequest.current = null;
        setLoadingCandidates(false);
      }
    }
  }, [offset, total]);

  useEffect(() => {
    if (!loadingCandidates && !candidateError && candidatePagesLeft > 0) void loadCandidates();
  }, [loadCandidates, loadingCandidates, candidateError, candidatePagesLeft]);
  useEffect(() => () => {
    const request = candidateRequest.current;
    candidateRequest.current = null;
    request?.abort();
  }, []);



  useEffect(() => {
    const onState = (event: Event) => {
      const state = (event as CustomEvent<PersistentMusicPlayerState>).detail;
      setPlayingId(state?.track?.id ?? null);
    };
    window.addEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
    window.dispatchEvent(new Event(MUSIC_PLAYER_STATE_REQUEST_EVENT));
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
  }, []);

  const play = useCallback((all: MusicWork[], work: MusicWork) => {
    const track = playableTrack(work, true);
    if (!track) {
      setMessage(ja ? "この作品は外部サイトでだけ再生できます。" : "This work only plays on an external site.");
      return;
    }
    /* 続けて鳴る順: 押した曲、残りのオリジナル、最後に外部の曲。外部の曲はオリジナルが尽きてから。 */
    const queue = orderPlaybackQueue(all, work.id)
      .map((item) => playableTrack(item, false))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    setPersistentMusicQueue(queue, work.id);
    playPersistentMusic(track);
    setPlayingId(work.id);
    setMessage(null);
  }, [ja]);

  /* 外部の曲の候補。Hub のオリジナルは含めない（オリジナルは棚の works で別に出す）。 */
  const externalPool = canonicalizeMusicWorks([...shelves.flatMap(shelf => [...shelf.works, ...(shelf.external ?? [])]), ...extraWorks]).filter(work => !isHubOriginalWork(work));
  const genreCounts = new Map<string, number>();
  for (const work of externalPool) genreCounts.set(work.genre, (genreCounts.get(work.genre) ?? 0) + 1);
  const expandedShelves: MusicShelf[] = expandGenres ? [
    ...shelves.filter(shelf => !shelf.id.startsWith("genre:")),
    ...(externalBrowse ? [...genreCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([genre]) => ({
      id: `genre:${genre}`, title: musicGenreChipLabel(genre), href: `/v2/music?genre=${encodeURIComponent(genre)}`,
      works: [] as MusicWork[], external: externalPool.filter(work => work.genre === genre),
    })) : []),
  ] : shelves;

  type ResolvedShelf = MusicShelf & { external: MusicWork[] };
  const resolved: ResolvedShelf[] = expandedShelves.map((shelf): ResolvedShelf => {
    if (shelf.id === "favorites") {
      /* お気に入りは本人の選び。オリジナルを先に、外部の曲は別の見出しの下。 */
      const split = splitByOrigin(favoriteWorks.works.filter((work) => favorites.includes(work.id)));
      return { ...shelf, works: split.originals, external: split.external };
    }
    const originals = shelf.works.filter(work => isHubOriginalWork(work) && !feedback.isHidden(work.id));
    const pool = shelf.id === "popular" ? rankMusicWorks(externalPool)
      : shelf.id.startsWith("genre:") ? recommend(externalPool.filter(work => work.genre === shelf.id.slice(6)), favorites)
      : shelf.id === "hub-popular" ? []
      : recommend(externalPool, favorites);
    const filled = fillSlot(originals, pool.filter(work => !feedback.isHidden(work.id)), MUSIC_SLOT_SIZE);
    return { ...shelf, works: filled.originals, external: filled.external };
  });
  const visibleShelves = resolved.filter((shelf) => shelf.works.length || shelf.external.length || shelf.id === "hub-latest");

  const dismissible = (shelf: ResolvedShelf) => shelf.id === "hub-latest" || shelf.id === "recommended" || shelf.id.startsWith("genre:");
  const play2 = (shelf: ResolvedShelf, work: MusicWork) => play([...shelf.works, ...shelf.external], work);
  const fav = (work: MusicWork) => ({ favorite: favorites.includes(work.id), favoriteSaving: favoriteState.saving, onFavorite: () => void favoriteState.toggle(work.id) });
  const row = (shelf: ResolvedShelf, work: MusicWork) => <V2MusicRow key={work.id} work={work} compact current={playingId === work.id} japanese={ja} onPlay={() => play2(shelf, work)} {...fav(work)} onDismiss={dismissible(shelf) && !isHubOriginalWork(work) ? () => feedback.dismiss(work.id) : undefined} />;

  /* 注目: 「Hub Music」の棚の先頭のオリジナル。無ければ（0曲）同じ位置で最初の公開を誘う。 */
  const lead = visibleShelves.find((shelf) => shelf.id === "hub-latest");
  const hero = lead?.works[0];
  const originalShelves = visibleShelves.filter((shelf) => shelf.works.length);
  const externalGroups = visibleShelves.filter((shelf) => shelf.external.length);
  const externalTotal = externalGroups.reduce((sum, shelf) => sum + shelf.external.length, 0);

  return (
    <div className="v2-shelves">
      {message ? <p className="v2-error" role="status">{message}</p> : null}
      {favoriteState.error ? <p className="v2-error" role="alert">{favoriteState.error === "cache"
        ? (ja ? "アカウントに保存しましたが、この端末には記録できませんでした。" : "Saved to your account, but could not update this device's cache.")
        : (ja ? "お気に入りを保存できませんでした。もう一度お試しください。" : "Could not save favourites. Please try again.")}</p> : null}
      {candidateError ? <p role="alert">{ja ? "候補を取得できませんでした。もう一度お試しください。" : "Could not load candidates. Please try again."}</p> : null}
      <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} />
      {!visibleShelves.length && (!hasFavoriteShelf || favoriteWorks.status === "ready") ? <p className="v2-note">{ja ? "表示できる作品がありません。検索や設定の非表示リセットから探せます。" : "No works to show. Try search or reset hidden recommendations in settings."}</p> : null}

      {hero && lead ? <V2MusicHero work={hero} current={playingId === hero.id} japanese={ja} onPlay={() => play2(lead, hero)} {...fav(hero)} /> : null}

      {originalShelves.map((shelf) => (
        <section key={shelf.id} className="v2-shelf" aria-label={shelf.title}>
          <header className="v2-shelf__head">
            <h2 className="v2-shelf__title">{shelf.title}</h2>
            {shelf.href ? <Link className="v2-card__link" href={shelf.href}>{ja ? "すべて見る" : "See all"}</Link> : null}
          </header>
          <ul className="v2-shelf__rail">
            {shelf.works.map((work) => <V2MusicTile key={work.id} work={work} current={playingId === work.id} japanese={ja} onPlay={() => play2(shelf, work)} {...fav(work)} />)}
          </ul>
        </section>
      ))}

      {externalTotal ? (
        <section className="v2-ext" aria-labelledby="v2-ext-title">
          <header className="v2-ext__head">
            <h2 id="v2-ext-title" className="v2-shelf__title">YouTube Music</h2>
          </header>
          {externalGroups.map((shelf) => (
            <section key={shelf.id} className="v2-ext__group" aria-label={shelf.id === "hub-latest" ? undefined : shelf.title}>
              {shelf.id === "hub-latest" ? null : <div className="v2-ext__subhead"><h3 className="v2-ext__sub">{shelf.title}</h3>{shelf.href ? <Link className="v2-card__link" href={shelf.href}>{ja ? "すべて見る" : "See all"}</Link> : null}</div>}
              <ul className="v2-music-rows">{shelf.external.map((work) => row(shelf, work))}</ul>
            </section>
          ))}
        </section>
      ) : null}
      {lead && !hero ? <p className="v2-mfirst" aria-label={ja ? "最初のオリジナル" : "First original"}>
        <span className="v2-mfirst__note">{ja ? "Hub Musicのオリジナルはまだありません。" : "No Hub originals yet."}</span>
        <Link className="v2-card__link" href="/v2/music/upload">{ja ? "曲を公開" : "Publish a track"}</Link>
      </p> : null}
      {/* 読み込み中の表示は本文の下に置く。上に差し込むと棚が押し下げられる（CLS）。 */}
      {hasFavoriteShelf && favoriteWorks.status !== "ready" ? <p role="status">{favoriteWorks.status === "loading"
        ? (ja ? "お気に入りを読み込み中…" : "Loading favourites…")
        : <>{ja ? "お気に入りの作品を読み込めませんでした。" : "Could not load favourite works."}<button className="v2-button v2-button--text" onClick={favoriteWorks.retry}>{ja ? "もう一度読み込む" : "Try again"}</button></>}</p> : null}
      {offset < total ? <button type="button" className="v2-toggle v2-toggle--text" disabled={loadingCandidates} onClick={() => { setCandidateError(false); setCandidatePagesLeft(20); }}>{loadingCandidates ? (ja ? "候補を読み込み中…" : "Loading candidates…") : candidateError ? (ja ? "候補の取得を再試行" : "Retry candidates") : (ja ? "おすすめの候補をさらに探す" : "Find more recommendation candidates")}</button> : null}
    </div>
  );
}
