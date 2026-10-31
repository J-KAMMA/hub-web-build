"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { canonicalizeMusicWork, musicAlbumLabel, musicGenrePathLabel, musicWorkArtworkUrl, type MusicWork } from "@/lib/music-catalog";
import { playPersistentMusic, setPersistentMusicQueue, type PersistentMusicTrack } from "@/lib/music-player-events";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";

type LibraryTab = "favorites" | "later" | "artists" | "albums";
type LibraryCatalogState =
  | { status: "loading"; works: MusicWork[] }
  | { status: "ready"; works: MusicWork[] }
  | { status: "empty"; works: [] }
  | { status: "error"; works: MusicWork[] };

const ORIGINAL_TRACK_PREFIX = "music:";
const MUSIC_CATALOG_TIMEOUT_MS = 10_000;

function readIds(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

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
  return service ? { id: work.id, title: work.title, artist: work.artist, genre: work.genre, provider: "youtube", providerLabel: service.label, artworkUrl: musicWorkArtworkUrl(work), embedUrl: service.embedUrl, externalUrl: service.url, autoplay: true } : null;
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

function normalizeLibraryWorks(works: MusicWork[]) {
  return [...new Map(
    works.map((work) => {
      const normalized = canonicalizeMusicWork(work);
      return [normalized.id, normalized] as const;
    }),
  ).values()];
}

export function MusicLibrary() {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const [catalogState, setCatalogState] = useState<LibraryCatalogState>({
    status: "loading",
    works: [],
  });
  const [tab, setTab] = useState<LibraryTab>("favorites");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [laterIds, setLaterIds] = useState<string[]>([]);
  const [savedArtists, setSavedArtists] = useState<string[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<string[]>([]);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const works = catalogState.works;
  const loadLibrary = useCallback(async () => {
    activeRequestRef.current?.controller.abort();
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };
    const ownsRequest = () => activeRequestRef.current?.id === requestId;
    setCatalogState((current) => ({
      status: "loading",
      works: current.works,
    }));
    const favorites = readIds("music.favorites");
    const later = readIds("music.listen-later");
    const artists = readIds("music.saved-artists");
    const albums = readIds("music.saved-albums");
    setFavoriteIds(favorites); setLaterIds(later); setSavedArtists(artists); setSavedAlbums(albums);
    const params = new URLSearchParams();
    if (favorites.length || later.length) params.set("ids", [...new Set([...favorites, ...later])].slice(0, 200).join(","));
    if (artists.length) params.set("artists", artists.slice(0, 40).join("\u0000"));
    if (albums.length) params.set("albums", albums.slice(0, 40).join("\u0000"));
    try {
      const response = await fetch(`/api/music/library-catalog?${params}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(MUSIC_CATALOG_TIMEOUT_MS),
        ]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as unknown;
      if (
        !result
        || typeof result !== "object"
        || !Array.isArray((result as { works?: unknown }).works)
        || !(result as { works: unknown[] }).works.every(isMusicWork)
      ) {
        throw new Error("invalid_music_library");
      }
      if (!ownsRequest()) return;
      const next = normalizeLibraryWorks(
        (result as { works: MusicWork[] }).works,
      );
      setCatalogState(next.length
        ? { status: "ready", works: next }
        : { status: "empty", works: [] });
    } catch (error: unknown) {
      if (!ownsRequest()) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCatalogState((current) => ({
        status: "error",
        works: current.works,
      }));
    } finally {
      if (ownsRequest()) activeRequestRef.current = null;
    }
  }, []);
  useEffect(() => {
    void loadLibrary();
    return () => {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    };
  }, [loadLibrary]);
  const favorites = favoriteIds.map((id) => works.find((work) => work.id === id)).filter((work): work is MusicWork => Boolean(work));
  const later = laterIds.map((id) => works.find((work) => work.id === id)).filter((work): work is MusicWork => Boolean(work));
  const inferredArtists = favorites.map((work) => work.artist);
  const artists = [...new Set([...savedArtists, ...inferredArtists])].sort((a, b) => a.localeCompare(b, "ja"));
  const inferredAlbums = favorites.map((work) => `${work.artist}\u0000${musicAlbumLabel(work)}`);
  const albums = [...new Set([...savedAlbums, ...inferredAlbums])];
  const visibleTracks = tab === "favorites" ? favorites : later;
  const play = (work: MusicWork) => {
    const queue = visibleTracks.map(persistentTrackFor).filter((item): item is PersistentMusicTrack => Boolean(item));
    const track = persistentTrackFor(work);
    if (!track) return;
    setPersistentMusicQueue(queue, work.id);
    playPersistentMusic(track);
  };

  return <section className="music-library-page">
    <header><div><p>お気に入り、あとで聴く、保存したアーティストと作品をまとめます。</p></div><nav><Link href={hubSurfacePath(surface, "/music/history")}>履歴</Link><Link href={hubSurfacePath(surface, "/lists?tab=playlists")}>プレイリスト</Link><Link href={hubSurfacePath(surface, "/music")}>音楽へ戻る</Link></nav></header>
    <nav className="music-library-page__tabs" role="tablist" aria-label="ライブラリ">
      {([ ["favorites", `お気に入り ${favorites.length}`], ["later", `あとで聴く ${later.length}`], ["artists", `アーティスト ${artists.length}`], ["albums", `アルバム・シングル ${albums.length}`] ] as const).map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {catalogState.status === "loading" && !works.length ? <V2State kind="loading" className="music-library-page__empty" rows={4} title="ライブラリを読み込んでいます" />
    : catalogState.status === "error" && !works.length ? <V2State kind="error" className="music-library-page__empty" title="ライブラリを読み込めませんでした" note="通信状態を確認して、もう一度お試しください。" action={{ label: "再試行", onClick: () => void loadLibrary() }} />
    : <>
      {catalogState.status === "loading" ? <UiStatePanel className="music-library-page__empty" state="loading" title="ライブラリを更新しています" /> : null}
      {catalogState.status === "error" ? <UiStatePanel className="music-library-page__empty" state="error" title="ライブラリを更新できませんでした" description="表示中の保存内容はそのまま利用できます。" action={<UiButton type="button" onClick={() => void loadLibrary()}>再試行</UiButton>} /> : null}
      {tab === "artists" ? <div className="music-library-page__collections">{artists.map((artist) => <Link key={artist} href={hubSurfacePath(surface, `/music/artists/${encodeURIComponent(artist)}`)}><strong>{artist}</strong><small>{works.filter((work) => work.artist === artist).length}曲</small></Link>)}</div>
    : tab === "albums" ? <div className="music-library-page__collections">{albums.map((entry) => { const [artist, album] = entry.split("\u0000"); return <Link key={entry} href={hubSurfacePath(surface, `/music/albums/${encodeURIComponent(album)}?artist=${encodeURIComponent(artist)}`)}><strong>{album}</strong><small>{artist}</small></Link>; })}</div>
    : visibleTracks.length ? <ol className="music-library-page__tracks">{visibleTracks.map((work) => <li key={work.id}><button type="button" onClick={() => play(work)}><span>{musicWorkArtworkUrl(work) ? <img src={musicWorkArtworkUrl(work)} alt="" loading="lazy" /> : "♫"}<i aria-hidden="true">▶</i></span><span><small>{musicGenrePathLabel(work.genre)} · {work.year}</small><strong>{work.title}</strong><b>{work.artist}</b></span></button></li>)}</ol>
    : <V2Empty title="まだ保存されていません" note="曲一覧や作品ページから追加できます。" action={{ label: "曲を探す", href: hubSurfacePath(surface, "/music") }} />}
    </>}
  </section>;
}
