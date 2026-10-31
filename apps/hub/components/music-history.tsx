"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { canonicalizeMusicWork, hasHubFullPlaybackSource, musicGenrePathLabel, musicWorkArtworkUrl, type MusicWork } from "@/lib/music-catalog";
import { EMPTY_MUSIC_LISTENING_PROFILE, MUSIC_LISTENING_PROFILE_CHANGED_EVENT, readMusicListeningProfile, type MusicListeningProfile } from "@/lib/music-listening-profile";
import { MUSIC_FAVORITES_CHANGED_EVENT, playPersistentMusic, setPersistentMusicQueue, type PersistentMusicTrack } from "@/lib/music-player-events";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";

const FAVORITES_KEY = "music.favorites";
const ORIGINAL_TRACK_PREFIX = "music:";
const MUSIC_CATALOG_TIMEOUT_MS = 10_000;

type HistoryCatalogState =
  | { status: "loading"; works: MusicWork[] }
  | { status: "ready"; works: MusicWork[] }
  | { status: "empty"; works: MusicWork[] }
  | { status: "error"; works: MusicWork[] };

function persistentTrackFor(work: MusicWork): PersistentMusicTrack | null {
  if (work.id.startsWith(ORIGINAL_TRACK_PREFIX)) {
    const trackId = work.id.slice(ORIGINAL_TRACK_PREFIX.length);
    if (!trackId) return null;
    return {
      id: work.id,
      title: work.title,
      artist: work.artist,
      genre: work.genre,
      provider: "hub",
      providerLabel: "Hub Music",
      artworkUrl: musicWorkArtworkUrl(work),
      audioUrl: `/music/api/tracks/${encodeURIComponent(trackId)}/audio`,
      autoplay: true,
    };
  }
  const service = work.services.find((item) => item.provider === "youtube" && item.embedUrl);
  return service ? { id: work.id, title: work.title, artist: work.artist, provider: "youtube", providerLabel: service.label, artworkUrl: musicWorkArtworkUrl(work), embedUrl: service.embedUrl, externalUrl: service.url, autoplay: true } : null;
}

function playTrack(work: MusicWork, queue: MusicWork[]) {
  const track = persistentTrackFor(work);
  if (!track) return;
  setPersistentMusicQueue(queue.map(persistentTrackFor).filter((item): item is PersistentMusicTrack => Boolean(item)), work.id);
  playPersistentMusic(track);
}

function isMusicWork(value: unknown): value is MusicWork {
  if (!value || typeof value !== "object") return false;
  const work = value as Partial<MusicWork>;
  return typeof work.id === "string"
    && typeof work.title === "string"
    && typeof work.artist === "string"
    && typeof work.description === "string"
    && typeof work.genre === "string"
    && typeof work.year === "number"
    && Array.isArray(work.services);
}

function normalizeHistoryWorks(works: MusicWork[]) {
  return [...new Map(
    works
      .map(canonicalizeMusicWork)
      .filter((work) =>
        work.id.startsWith(ORIGINAL_TRACK_PREFIX)
        || hasHubFullPlaybackSource(work))
      .map((work) => [work.id, work] as const),
  ).values()];
}

export function MusicHistory({ initialWorks }: { initialWorks: MusicWork[] }) {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const fallbackWorks = useMemo(
    () => normalizeHistoryWorks(initialWorks),
    [initialWorks],
  );
  const [catalogState, setCatalogState] = useState<HistoryCatalogState>({
    status: "loading",
    works: fallbackWorks,
  });
  const [profile, setProfile] = useState<MusicListeningProfile>(EMPTY_MUSIC_LISTENING_PROFILE);
  const [profileReady, setProfileReady] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritePending, setFavoritePending] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const requestSequenceRef = useRef(0);
  const favoriteInFlight = useRef(false);
  const activeRequestRef = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const works = catalogState.works;
  useEffect(() => {
    setProfile(readMusicListeningProfile());
    setProfileReady(true);
    try {
      const stored = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setFavoriteIds(stored.filter((id): id is string => typeof id === "string"));
    } catch { /* preferences are optional */ }
    const sync = (event: Event) => setProfile((event as CustomEvent<MusicListeningProfile>).detail);
    const syncFavorites = (event: Event) => setFavoriteIds((event as CustomEvent<string[]>).detail);
    window.addEventListener(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, sync);
    window.addEventListener(MUSIC_FAVORITES_CHANGED_EVENT, syncFavorites);
    return () => {
      window.removeEventListener(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, sync);
      window.removeEventListener(MUSIC_FAVORITES_CHANGED_EVENT, syncFavorites);
    };
  }, []);
  useEffect(() => {
    if (!profileReady) return;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    const ids = [...new Set(profile.history.map((entry) => entry.id))]
      .slice(0, 30);
    if (!ids.length) {
      setCatalogState({ status: "empty", works: fallbackWorks });
      return;
    }
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };
    const ownsRequest = () => activeRequestRef.current?.id === requestId;
    setCatalogState((current) => ({
      status: "loading",
      works: current.works,
    }));
    void fetch(`/api/music/library-catalog?${new URLSearchParams({
      ids: ids.join(","),
    })}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(MUSIC_CATALOG_TIMEOUT_MS),
      ]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json() as unknown;
        if (
          !result
          || typeof result !== "object"
          || !Array.isArray((result as { works?: unknown }).works)
          || !(result as { works: unknown[] }).works.every(isMusicWork)
        ) {
          throw new Error("invalid_music_history");
        }
        return normalizeHistoryWorks(
          (result as { works: MusicWork[] }).works,
        );
      })
      .then((next) => {
        if (!ownsRequest()) return;
        setCatalogState(next.length
          ? { status: "ready", works: next }
          : { status: "empty", works: [] });
      })
      .catch((error: unknown) => {
        if (!ownsRequest()) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCatalogState((current) => ({
          status: "error",
          works: current.works,
        }));
      })
      .finally(() => {
        if (ownsRequest()) activeRequestRef.current = null;
      });
    return () => {
      if (activeRequestRef.current?.id !== requestId) return;
      activeRequestRef.current = null;
      controller.abort();
    };
  }, [fallbackWorks, profile.history, profileReady, retryNonce]);
  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);
  const toggleFavorite = async (id: string) => {
    if (favoriteInFlight.current) return;
    const current = [...new Set(favoriteIds)];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    favoriteInFlight.current = true;
    setFavoritePending(id);
    setFavoriteError(false);
    try {
      const response = await fetch("/api/music/favorites", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ workIds: next }) });
      if (response.status !== 401) {
        const payload = await response.json().catch(() => null) as { updated?: unknown; favoriteIds?: unknown } | null;
        if (!response.ok || payload?.updated !== true || !Array.isArray(payload.favoriteIds) || payload.favoriteIds.length !== next.length || new Set(payload.favoriteIds).size !== next.length || payload.favoriteIds.some((item) => typeof item !== "string" || !next.includes(item))) throw new Error("Could not confirm favourites");
      }
      setFavoriteIds(next);
      try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* preferences are optional */ }
      window.dispatchEvent(new CustomEvent<string[]>(MUSIC_FAVORITES_CHANGED_EVENT, { detail: next }));
    } catch {
      setFavoriteError(true);
    } finally {
      favoriteInFlight.current = false;
      setFavoritePending(null);
    }
  };
  const history = profile.history.map((entry) => works.find((work) => work.id === entry.id)).filter((work): work is MusicWork => Boolean(work));
  return <section className="music-history-page">
    <header><div><p>この端末で再生した曲を新しい順に表示します。</p></div><nav><a href={hubSurfacePath(surface, "/music")}>音楽へ戻る</a><a href={hubSurfacePath(surface, "/lists?tab=playlists")}>プレイリスト</a></nav></header>
    {catalogState.status === "loading" && !history.length ? <V2State kind="loading" className="music-history-page__empty" rows={4} title="再生履歴を読み込んでいます" />
    : catalogState.status === "error" && !history.length ? <V2State kind="error" className="music-history-page__empty" title="再生履歴を読み込めませんでした" note="通信状態を確認して、もう一度お試しください。" action={{ label: "再試行", onClick: () => setRetryNonce((value) => value + 1) }} />
    : <>
      {catalogState.status === "loading" ? <UiStatePanel className="music-history-page__empty" state="loading" title="再生履歴を更新しています" /> : null}
      {catalogState.status === "error" ? <UiStatePanel className="music-history-page__empty" state="error" title="再生履歴を更新できませんでした" description="表示中の履歴はそのまま利用できます。" action={<UiButton type="button" onClick={() => setRetryNonce((value) => value + 1)}>再試行</UiButton>} /> : null}
      {favoriteError ? <p role="status">お気に入りを保存できませんでした。もう一度お試しください。</p> : null}
      {history.length ? <ol>{history.map((work) => <li key={work.id}><button type="button" onClick={() => playTrack(work, history)}>
      <span className="music-history-page__art">{musicWorkArtworkUrl(work) ? <img src={musicWorkArtworkUrl(work)} alt="" /> : "♪"}<i aria-hidden="true">▶</i></span><span><small>{musicGenrePathLabel(work.genre)} · {work.year}</small><strong>{work.title}</strong><b>{work.artist}</b></span>
    </button><button type="button" className="music-history-page__favorite" disabled={favoritePending !== null} onClick={() => void toggleFavorite(work.id)} aria-label={favoriteIds.includes(work.id) ? `${work.title}のお気に入りを解除` : `${work.title}をお気に入りに追加`} aria-pressed={favoriteIds.includes(work.id)}>{favoriteIds.includes(work.id) ? "♥" : "♡"}</button></li>)}</ol> : <V2Empty title="再生履歴はまだありません" note="音楽ページで曲を再生すると、ここへ追加されます。" action={{ label: "曲を探す", href: hubSurfacePath(surface, "/music") }} />}
    </>}
  </section>;
}
