"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { musicAlbumLabel, musicWorkArtworkUrl, musicDisplayTitle, type MusicWork } from "@/lib/music-catalog";
import {
  enqueueNextPersistentMusic,
  MUSIC_FAVORITES_CHANGED_EVENT,
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  playPersistentMusic,
  setPersistentMusicQueue,
  type PersistentMusicPlayerState,
  type PersistentMusicTrack,
} from "@/lib/music-player-events";
import { playableTrack } from "@/lib/v2-music";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

const FAVORITES_KEY = "music.favorites";

/* 再生できる形への変換は一覧・棚と同じ道（lib/v2-music.ts）。Hub の曲も YouTube の曲も扱う。 */
function persistentTrackFor(work: MusicWork): PersistentMusicTrack | null {
  return playableTrack(work, true);
}

export function MusicCollectionView({ title, description, works, collectionType, collectionId }: { title: string; description: string; works: MusicWork[]; collectionType: "artist" | "album"; collectionId: string }) {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const storageKey = collectionType === "artist" ? "music.saved-artists" : "music.saved-albums";
  const [saved, setSaved] = useState(false);
  const [player, setPlayer] = useState<{ id: string | null; playing: boolean }>({ id: null, playing: false });
  const playable = useMemo(() => works.map(persistentTrackFor).filter((item): item is PersistentMusicTrack => Boolean(item)), [works]);
  const heroArtwork = useMemo(() => works.map((work) => musicWorkArtworkUrl(work)).find(Boolean), [works]);
  const artists = useMemo(() => [...new Set(works.map((work) => work.artist))], [works]);

  useEffect(() => {
    try {
      const favorites = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
      const collections = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
      if (Array.isArray(favorites)) setFavoriteIds(favorites.filter((item): item is string => typeof item === "string"));
      if (Array.isArray(collections)) setSaved(collections.includes(collectionId));
    } catch { /* optional local library */ }
  }, [collectionId, storageKey]);

  /* いま鳴っている曲を知り、行に再生中の印を出す。 */
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<PersistentMusicPlayerState>).detail;
      setPlayer({ id: detail?.track?.id ?? null, playing: Boolean(detail?.playing) });
    };
    window.addEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
    window.dispatchEvent(new Event(MUSIC_PLAYER_STATE_REQUEST_EVENT));
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
  }, []);

  const play = (work: MusicWork) => {
    const track = persistentTrackFor(work);
    if (!track) return;
    setPersistentMusicQueue(playable, work.id);
    playPersistentMusic(track);
  };
  /* 全曲再生。待ち行列を入れ替えて先頭から鳴らす。 */
  const playAll = () => {
    const first = playable[0];
    if (!first) return;
    setPersistentMusicQueue(playable, first.id);
    playPersistentMusic(first);
  };
  const toggleFavorite = (id: string) => {
    const next = favoriteIds.includes(id) ? favoriteIds.filter((item) => item !== id) : [...favoriteIds, id];
    setFavoriteIds(next);
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent<string[]>(MUSIC_FAVORITES_CHANGED_EVENT, { detail: next }));
    void fetch("/api/music/favorites", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ workIds: next }) });
  };
  const toggleSaved = () => {
    let current: string[] = [];
    try { current = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as string[]; } catch { /* start clean */ }
    const next = saved ? current.filter((item) => item !== collectionId) : [...new Set([...current, collectionId])];
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setSaved(!saved);
  };

  const typeLabel = collectionType === "artist" ? "アーティスト" : works.length > 1 ? "アルバム" : "シングル";
  const subtitle = collectionType === "artist" ? description : artists.join("、");

  return <section className="music-collection-page v2-mc">
    <div className="v2-mc__hero">
      <div className="v2-mc__cover" aria-hidden="true">{heroArtwork ? <img src={heroArtwork} alt="" referrerPolicy="no-referrer" /> : <span>♫</span>}</div>
      <div className="v2-mc__meta">
        <small>{typeLabel}</small>
        <h1>{title}</h1>
        <p>{subtitle}{subtitle ? " · " : ""}{works.length}曲</p>
        <div className="v2-mc__actions">
          <button type="button" className="v2-mc__play" disabled={!playable.length} onClick={playAll}>再生</button>
          <button type="button" onClick={toggleSaved} aria-pressed={saved}>{saved ? "ライブラリから削除" : "ライブラリに保存"}</button>
          <Link href={hubSurfacePath(surface, "/music/library")}>ライブラリ</Link>
          <Link href={hubSurfacePath(surface, "/music")}>音楽へ戻る</Link>
        </div>
      </div>
    </div>
    <ol className="v2-mc__tracks">{works.map((work, index) => {
      const artwork = musicWorkArtworkUrl(work);
      const queued = persistentTrackFor(work);
      const current = player.id === work.id;
      const name = musicDisplayTitle(work.title);
      return <li key={work.id} className={current ? "is-current" : undefined}>
        <button type="button" className="v2-mc__track" disabled={!queued} onClick={() => play(work)} aria-label={`${name}を再生`}>
          <b className="v2-mc__no">{current && player.playing ? "♪" : index + 1}</b>
          <span className="v2-mc__art">{artwork ? <img src={artwork} alt="" loading="lazy" referrerPolicy="no-referrer" /> : "♫"}</span>
          <span className="v2-mc__text"><strong>{name}</strong><em>{work.artist} · {musicAlbumLabel(work)}</em></span>
        </button>
        <div className="v2-mc__row-actions"><button type="button" disabled={!queued} onClick={() => { if (queued) enqueueNextPersistentMusic(queued); }} aria-label={`${name}を次に再生`}>＋</button><button type="button" onClick={() => toggleFavorite(work.id)} aria-pressed={favoriteIds.includes(work.id)} aria-label={`${name}のお気に入りを切り替え`}>{favoriteIds.includes(work.id) ? "♥" : "♡"}</button></div>
      </li>;
    })}</ol>
  </section>;
}
