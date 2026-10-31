"use client";

import { useCallback, useEffect, useState } from "react";

import { V2MusicRow } from "@/components/v2/v2-music-row";
import { isHubOriginalWork, type MusicWork } from "@/lib/music-catalog";
import {
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  playPersistentMusic,
  setPersistentMusicQueue,
  type PersistentMusicPlayerState,
} from "@/lib/music-player-events";
import { useMusicFavorites } from "@/lib/use-music-favorites";
import { playableTrack } from "@/lib/v2-music";

/* The song named by `?work=`, highlighted above the shelves. It never starts playing by itself. */
export function V2MusicShared({ work, initialFavoriteIds, authenticated, locale }: { work: MusicWork; initialFavoriteIds: string[]; authenticated: boolean; locale: string }) {
  const japanese = locale === "ja";
  const favoriteState = useMusicFavorites(initialFavoriteIds, authenticated);
  const [playingId, setPlayingId] = useState<string | null>(null);
  useEffect(() => {
    const onState = (event: Event) => setPlayingId((event as CustomEvent<PersistentMusicPlayerState>).detail?.track?.id ?? null);
    window.addEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
    window.dispatchEvent(new Event(MUSIC_PLAYER_STATE_REQUEST_EVENT));
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
  }, []);
  const play = useCallback(() => {
    const track = playableTrack(work, true);
    if (!track) return;
    const queued = playableTrack(work, false);
    if (queued) setPersistentMusicQueue([queued], work.id);
    playPersistentMusic(track);
    setPlayingId(work.id);
  }, [work]);
  return <section className="v2-music-shared" aria-label={japanese ? "共有された曲" : "Shared song"}>
    <h2 className="v2-music-shared__label">{japanese ? "共有された曲" : "Shared song"}</h2>
    <ul className="v2-music-results">
      <V2MusicRow work={work} compact={!isHubOriginalWork(work)} current={playingId === work.id} favorite={favoriteState.favorites.includes(work.id)}
        favoriteSaving={favoriteState.saving} japanese={japanese} onPlay={play} onFavorite={() => void favoriteState.toggle(work.id)} />
    </ul>
  </section>;
}
