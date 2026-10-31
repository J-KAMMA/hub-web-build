"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useMemo, useState } from "react";

import { SearchSubmitButton } from "@/components/search-submit-button";
import type { PublicTrack } from "@/components/music-upload-panel";
import {
  MUSIC_FAVORITES_CHANGED_EVENT,
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  MUSIC_PLAYER_TOGGLE_EVENT,
  playPersistentMusic,
  setPersistentMusicQueue,
  type PersistentMusicPlayerState,
  type PersistentMusicTrack,
} from "@/lib/music-player-events";

const EMPTY_STATE: PersistentMusicPlayerState = {
  track: null,
  playing: false,
  volume: 80,
  queue: [],
};

const FAVORITES_KEY = "music.favorites";
const PLAYLISTS_KEY = "music.playlists";
const ORIGINAL_TRACK_PREFIX = "music:";

type MusicPlaylistView = {
  id: string;
  title: string;
  workIds: string[];
};

function trackKey(trackId: string) {
  return `${ORIGINAL_TRACK_PREFIX}${trackId}`;
}

function persistentTrack(track: PublicTrack): PersistentMusicTrack {
  return {
    id: trackKey(track.id),
    title: track.title,
    artist: track.artist,
    genre: "Hub Music",
    provider: "hub",
    providerLabel: "Hub Music",
    artworkUrl: track.artworkUrl,
    audioUrl: `/music/api/tracks/${encodeURIComponent(track.id)}/audio`,
  };
}

export function MusicRightRail() {
  const [player, setPlayer] = useState(EMPTY_STATE);
  const [tracks, setTracks] = useState<PublicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [panelTab, setPanelTab] = useState<"discover" | "playlists">("discover");
  const [playlists, setPlaylists] = useState<MusicPlaylistView[]>([]);
  const [playlistId, setPlaylistId] = useState("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesRemote, setFavoritesRemote] = useState(false);

  useEffect(() => {
    const update = (event: Event) => {
      setPlayer((event as CustomEvent<PersistentMusicPlayerState>).detail ?? EMPTY_STATE);
    };
    window.addEventListener(MUSIC_PLAYER_STATE_EVENT, update);
    window.dispatchEvent(new Event(MUSIC_PLAYER_STATE_REQUEST_EVENT));
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_EVENT, update);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/music/api/tracks", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      return response.json() as Promise<{ tracks?: PublicTrack[] }>;
    }).then((result) => {
      if (active) setTracks(Array.isArray(result.tracks) ? result.tracks : []);
    }).catch(() => {
      if (active) setTracks([]);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setFavoriteIds(stored.filter((id): id is string => typeof id === "string"));
    } catch {
      // Local preferences are optional.
    }
    let active = true;
    void fetch("/api/music/favorites", { credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<{ favoriteIds?: string[] }> : null)
      .then((result) => {
        if (!active || !result) return;
        setFavoritesRemote(true);
        setFavoriteIds(Array.isArray(result.favoriteIds) ? result.favoriteIds : []);
      })
      .catch(() => undefined);
    const sync = (event: Event) => {
      const next = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(next)) setFavoriteIds(next);
    };
    window.addEventListener(MUSIC_FAVORITES_CHANGED_EVENT, sync);
    return () => {
      active = false;
      window.removeEventListener(MUSIC_FAVORITES_CHANGED_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PLAYLISTS_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        setPlaylists(stored.filter((item): item is MusicPlaylistView => Boolean(item)
          && typeof item === "object"
          && typeof Reflect.get(item, "id") === "string"
          && typeof Reflect.get(item, "title") === "string"
          && Array.isArray(Reflect.get(item, "workIds"))));
      }
    } catch {
      // Local preferences are optional.
    }
    let active = true;
    void fetch("/api/music/playlists", { credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<{ playlists?: MusicPlaylistView[] }> : null)
      .then((result) => {
        if (active && result?.playlists?.length) setPlaylists(result.playlists);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const visibleTracks = useMemo(() => {
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
    const playlist = playlists.find((item) => item.id === playlistId);
    const playlistIds = playlist ? new Set(playlist.workIds) : null;
    return tracks.filter((track) => {
      if (playlistIds && !playlistIds.has(trackKey(track.id))) return false;
      if (!normalized) return true;
      return [track.title, track.artist, track.album, track.description]
        .some((value) => value?.normalize("NFKC").toLocaleLowerCase("ja").includes(normalized));
    });
  }, [playlistId, playlists, query, tracks]);

  const playTrack = (track: PublicTrack) => {
    const key = trackKey(track.id);
    if (player.track?.id === key) {
      window.dispatchEvent(new Event(MUSIC_PLAYER_TOGGLE_EVENT));
      return;
    }
    const selected = persistentTrack(track);
    const queue = visibleTracks.map(persistentTrack);
    setPersistentMusicQueue(queue, selected.id);
    playPersistentMusic(selected);
  };

  const toggleFavorite = (track: PublicTrack) => {
    const key = trackKey(track.id);
    const next = favoriteIds.includes(key)
      ? favoriteIds.filter((id) => id !== key)
      : [...favoriteIds, key];
    setFavoriteIds(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // Local preferences are optional.
    }
    window.dispatchEvent(new CustomEvent<string[]>(MUSIC_FAVORITES_CHANGED_EVENT, { detail: next }));
    if (!favoritesRemote) return;
    void fetch("/api/music/favorites", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workIds: next }),
    }).catch(() => undefined);
  };

  return <aside className="music-right-rail" aria-label="音楽">
    <header><div><h2>音楽</h2><small>HUB MUSIC</small></div></header>
    <nav aria-label="音楽メニュー" role="tablist">
      <button type="button" role="tab" aria-selected={panelTab === "discover"} className={panelTab === "discover" ? "is-active" : ""} onClick={() => { setPanelTab("discover"); setPlaylistId("all"); }}>曲を探す</button>
      <button type="button" role="tab" aria-selected={panelTab === "playlists"} className={panelTab === "playlists" ? "is-active" : ""} onClick={() => { setPanelTab("playlists"); setPlaylistId(playlists[0]?.id ?? "all"); }}>プレイリスト</button>
    </nav>
    <section className="music-right-rail__library" aria-label="Hub Musicライブラリ">
      <form className="music-right-rail__search" role="search" onSubmit={(event) => { event.preventDefault(); setQuery(searchDraft.trim()); }}>
        <input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.currentTarget.value)} placeholder="Hub Musicから検索" aria-label="音楽を検索" />
        <SearchSubmitButton label="検索" />
      </form>
      {panelTab === "playlists" ? <div className="music-right-rail__playlist-panel"><label className="music-right-rail__playlist-select">
        <span>プレイリスト</span>
        <select value={playlistId} onChange={(event) => setPlaylistId(event.currentTarget.value)} aria-label="プレイリストで絞り込む">
          <option value="all">すべての曲</option>
          {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}（{playlist.workIds.length}曲）</option>)}
        </select>
      </label><Link href="/lists?tab=playlists">プレイリストを管理</Link></div> : null}
      <div className="music-right-rail__track-heading"><strong>公開曲</strong><span>{visibleTracks.length}曲</span></div>
      <div className="music-right-rail__tracks">
        {visibleTracks.map((track) => {
          const key = trackKey(track.id);
          const active = player.track?.id === key;
          const favorite = favoriteIds.includes(key);
          return <div key={track.id} className={`music-right-rail__track${active ? " is-active" : ""}`}>
            <button type="button" className="music-right-rail__track-play" onClick={() => playTrack(track)} aria-label={`${track.title}${active && player.playing ? "を一時停止" : "を再生"}`}>
              <span className="music-right-rail__track-art">{track.artworkUrl ? <img src={track.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true">♫</span>}</span>
              <i aria-hidden="true">{active && player.playing ? "Ⅱ" : "▶"}</i>
            </button>
            <span><strong>{track.title}</strong><small>{track.artist} · Hub Music</small></span>
            <button type="button" className={`music-right-rail__favorite${favorite ? " is-favorite" : ""}`} onClick={() => toggleFavorite(track)} aria-label={`${track.title}をお気に入り${favorite ? "から外す" : "に追加"}`} aria-pressed={favorite}>{favorite ? "♥" : "♡"}</button>
          </div>;
        })}
        {loading ? <p className="music-right-rail__no-results">公開曲を読み込んでいます…</p> : !visibleTracks.length ? <p className="music-right-rail__no-results">公開済みのHub音源はまだありません。</p> : null}
      </div>
    </section>
  </aside>;
}
